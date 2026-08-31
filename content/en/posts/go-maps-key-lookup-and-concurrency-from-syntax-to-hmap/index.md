+++
date = '2026-08-30T10:00:00+02:00'
draft = false
title = 'Key Lookup and Concurrency in Go Maps: From Syntax to hmap'
image = '/images/posts/mapas-de-go-busqueda-y-concurrencia-de-la-sintaxis-a-hmap/go-maps-header.jpg'
tags = ['Go', 'Golang', 'Maps', 'Concurrency', 'Internals', 'Performance']
summary = 'From the "comma ok" idiom all the way down to the hmap structure: how Go looks up keys under the hood, why maps are not goroutine-safe, and which synchronization strategy to pick between sync.Mutex, sync.RWMutex and sync.Map.'
translationKey = 'go-maps-key-lookup-concurrency-hmap'
+++

In **Go**, the built-in `map[K]V` is probably the most heavily used data structure in production code: in-memory caches, session indexes, message deduplication, service registries or middleware *routers*. It is so ubiquitous that we usually use it without asking ourselves **how it actually works underneath**: what really happens during a key lookup, why a missing key returns the type's zero value instead of an error, and what that dreaded `fatal error: concurrent map writes` that takes down an entire pod at 3 AM actually means.

This article covers the full journey: **from the syntax you write every day to the memory the runtime manages for you**. Every example has been compiled and executed with Go 1.27, and the fatal error *stack trace* you will see is real. The benchmark figures are one concrete measurement, not a universal property: they may vary with the hardware, operating system and parallelism settings.

---

## 1. The "comma ok" idiom: why it exists

Let's start with the question almost nobody asks after years of writing Go: **how do you know whether a key exists?**

```go
package main

import "fmt"

type Session struct {
	UserID string
	TTL    int
}

func main() {
	sessions := map[string]Session{
		"abc123": {UserID: "u-42", TTL: 3600},
	}

	// Without "comma ok": Go returns the zero value of the type, never an error.
	zero := sessions["xyz789"]
	fmt.Printf("without comma ok: %+v\n", zero)
	// Output: without comma ok: {UserID: TTL:0}

	// With "comma ok": we distinguish "missing" from "present with zero value".
	s, ok := sessions["xyz789"]
	if !ok {
		fmt.Println("session missing: force a re-login")
	} else {
		fmt.Println("session found:", s.UserID)
	}

	// Even more idiomatic: declare both variables inside the if itself.
	if s, ok := sessions["abc123"]; ok {
		fmt.Printf("active session: %s (TTL %ds)\n", s.UserID, s.TTL)
	}

	// Insert only if the key does not exist (the "load or store" pattern).
	if _, ok := sessions["def456"]; !ok {
		sessions["def456"] = Session{UserID: "u-77", TTL: 60}
	}
}
```

The expression `v, ok := m[key]` is the famous **"comma ok"**: a multiple assignment where the compiler expands the lookup into *two* values: the value associated with the key, and a boolean that tells you whether the key was present.

### Why is it necessary?

Because in Go **a missing key is not an error, it is the zero value**. Unlike Python (`KeyError`) or Java (`NullPointerException`/`Optional`), Go's design prioritizes the fact that a map read can never panic. The consequence is ambiguity: when you read `sessions["xyz789"].TTL == 0`, you cannot tell whether the session exists with `TTL = 0` or whether it does not exist at all.

This leads to subtle bugs in production:

```go
// BUG: never distinguishes "quota exhausted (0)" from "user not registered".
if quotas[userID] == 0 {
	return ErrNoQuota
}
```

```go
// CORRECT: the boolean disambiguates.
used, ok := quotas[userID]
if !ok {
	return ErrUnknownUser // the key does not exist
}
if used == 0 {
	return ErrNoQuota // it exists, but is zero
}
```

### Practical rules for "comma ok"

- If the zero value is **semantically valid** for your domain (`map[string]bool`, counters where zero carries no information), the plain `m[k]` read is perfectly idiomatic.
- If you need to **distinguish absence from a zero value**, always use the `ok` form.
- `if _, ok := m[k]; !ok` is the standard pattern to **insert only if absent** when there is no concurrent access. Under concurrency it is not atomic and is not equivalent to `sync.Map.LoadOrStore`.
- `delete(m, k)` on a missing key is a **no-op with no error**; no previous check is needed.
- A nil map (`var m map[string]int`) is **readable** (it returns the zero value and `ok = false`) but **not writable**: `m["a"] = 1` panics with the recoverable error `assignment to entry in nil map`. Always initialize with `make`.
- Map elements are **not addressable**: `&m[k]` does not compile, and you cannot modify a field of a struct stored by value directly (`m[k].Field = v`). Copy the value, modify it, and assign it back—or store pointers when that is the ownership model you need. A pointer to the copy is not a pointer to the map entry.

{{< details title="Test yourself: what does this code print?" >}}

```go
m := map[string]int{"a": 0}
v1, ok1 := m["a"]
v2, ok2 := m["b"]
fmt.Println(v1, ok1, v2, ok2)
```

**Options:** (a) `0 true 0 false`  (b) `0 false 0 false`  (c) it errors out because key `b` does not exist.

**Answer:** (a). Key `"a"` exists with value `0` (`0 true`); key `"b"` does not exist, so the zero value of the type is returned along with `ok = false` (`0 false`). This is exactly the case where the boolean is essential: both reads return `0`, but their meaning is the opposite.

{{< /details >}}

---

## 2. Internal anatomy: hmap and bmap

All of the above has a very concrete implementation in the runtime. For almost a decade, Go's map architecture (in `src/runtime/map.go`) was built on **hash tables with overflow-bucket chaining**. Understanding it pays off: it explains the real cost of a lookup, memory usage and behavior under growth. (If you run Go 1.24 or newer, stay until section 2.3: the implementation changed, but the concepts remain).

### 2.1 The header: `hmap`

Every map you create is, in reality, a pointer to this structure (Go 1.23, simplified from `runtime/map.go`):

```go
type hmap struct {
	count     int    // number of live cells (what len() returns)
	flags     uint8  // state flags (iteration in progress, writing in progress...)
	B         uint8  // log2 of the number of buckets: there are 2^B buckets
	noverflow uint16 // approximate number of overflow buckets
	hash0     uint32 // random hash seed (per map and per process)

	buckets    unsafe.Pointer // array of 2^B buckets
	oldbuckets unsafe.Pointer // previous array, only present while growing
	nevacuate  uintptr        // progress of the incremental evacuation

	extra *mapextra // statistics and optional overflow buckets
}
```

Three fields deserve special attention:

- **`hash0`**: a random seed, different for every map. Go randomizes it to prevent *hash flooding* attacks (an attacker sending keys crafted to collide into the same bucket and degrade the service to `O(n)`). Two maps with identical keys iterate in a different order — that is exactly why `map` iteration order is **deliberately randomized**.
- **`B`**: the table size is always a power of two (`2^B`), which lets the runtime index it with a simple bitmask instead of a modulo.
- **`oldbuckets` / `nevacuate`**: the **incremental growth** mechanism (more on that below).

### 2.2 The bucket: `bmap`, the 8-slot `tophash` array, and CPU cache cleverness

Each bucket (`bmap`) stores **exactly 8 cells**:

```go
// runtime/map.go (Go 1.23), the real structure:
type bmap struct {
	tophash [8]uint8 // high byte of each key's hash
	// Followed in memory, contiguously, by:
	//   - 8 keys (k0..k7)
	//   - 8 values (v0..v7)
	//   - 1 pointer to an overflow bucket
}
```

The structure is not fully declared in the source code: the compiler "knows" the rest of the layout and computes the key/value offsets at compile time. In memory, a bucket looks like this:

```
one bucket (bmap) - 8 cells
+--------------------------------------------------+
| tophash[0..7]                8 bytes             |
+--------------------------------------------------+
| k0 | k1 | k2 | k3 | k4 | k5 | k6 | k7 |          <- 8 contiguous keys
+--------------------------------------------------+
| v0 | v1 | v2 | v3 | v4 | v5 | v6 | v7 |          <- 8 contiguous values
+--------------------------------------------------+
| pointer to the overflow bucket                   |
+--------------------------------------------------+
```

**The `tophash` array** stores the **highest byte of the hash** of the key held in each cell. Its purpose is to act as an ultra-cheap filter: before comparing a candidate key (which can be a 100-byte `string`), the runtime first compares a single byte. If `tophash[i]` does not match the high byte of the searched hash, the cell is discarded **without ever touching the key**. Only if it matches does the runtime compare the real key with `==`. Most of the time, 8 one-byte comparisons resolve the lookup.

When the byte is smaller than `minTopHash` (5), it does not represent a hash but a **cell state**:

```go
emptyRest      = 0 // this cell is empty, and so are all the following ones (allows early scan exit)
emptyOne       = 1 // this cell is empty
evacuatedX     = 2 // key evacuated to the first half of the new table
evacuatedY     = 3 // key evacuated to the second half of the new table
evacuatedEmpty = 4 // empty cell in an already-evacuated bucket
minTopHash     = 5 // from here on, it is a real hash (compensated when stored)
```

**Why are keys and values stored separately and contiguously?** Two remarkably elegant performance reasons:

1. **Padding elimination**: if each cell were a paired key-value, memory alignment would force padding holes. A classic `map[int8]int64` would waste 7 bytes per cell (8 cells × 16 bytes = 128 bytes). With the separated layout, the 8 keys occupy 8 contiguous bytes and the 8 values occupy 64 contiguous bytes: **not a single padding byte**.
2. **Cache locality**: a lookup compares keys, not values. With all 8 keys together, scanning them fits in a few consecutive *cache lines*. Values, irrelevant during the search, do not pollute the cache with bytes you are not going to use.

### 2.3 The lookup, step by step

With all of the above, `v, ok := m[key]` executes this algorithm in the runtime (`mapaccess2`):

1. Compute `hash := Hash(key, hash0)`.
2. Bucket index: `hash & (2^B - 1)` (**low** bits of the hash).
3. Fast filter: `top := hash >> 56` (**high** bits, on 64-bit machines), compared against the 8 bytes of `tophash`.
4. For each cell with a matching `top`, compare the real key with `==`.
5. If the bucket is exhausted, follow the chain of **overflow buckets** (chaining).
6. If `emptyRest` is found, stop early: there are no more keys to look for.
7. If the map is mid-growth, also consult `oldbuckets` until the affected cells have been evacuated.

All of this is what a well-sized `m[k]` costs: **one hash, one bitmask, a handful of one-byte comparisons and one or two comparisons of the real key**. Constant and dirt cheap.

### 2.4 Growth: incremental evacuation

When `count > 6.5 × 2^B` (Go's classic *load factor*: 13/2), or when too many overflow buckets accumulate, the map may grow. In the first case it doubles `B` and allocates a new table; in the second it may perform a same-size grow to reorganize overflows. But it does **not copy everything at once** (that would create a latency spike fatal for a server): entries are **evacuated progressively** as writes happen (the `nevacuate` field tracks progress). During the transition, reads and writes consult both tables, and the `evacuatedX/Y` flags in `tophash` indicate where each key lives now. Iterators also start at a random bucket — hence the random order of `range`.

{{< details title="Go 1.24+: the Swiss Tables era (runtime update)" open=true >}}

If you run `go version` and see **Go 1.24 or newer**, the map running in production **no longer uses `hmap`/`bmap`**. The Go team rewrote the implementation based on **Swiss Tables** (the design behind Google's `absl` library), in `src/internal/runtime/maps/map.go`. You can read more in the [official article on Swiss Tables](https://go.dev/blog/swisstable). The current structure (Go 1.27) is:

```go
// src/internal/runtime/maps/map.go (Go 1.27)
type Map struct {
	used uint64 // number of elements (len())

	seed uintptr // random seed per map (the old hash0)

	// Directory of tables. If the map fits in a single group of
	// 8 entries, dirPtr points directly at that group (small map).
	dirPtr unsafe.Pointer
	dirLen int

	globalDepth uint8 // bits used to index the directory
	globalShift uint8

	// Writing-in-progress flag: toggled with XOR to maximize the
	// probability of detecting concurrent writers.
	writing uint8

	tombstonePossible bool
	clearSeq          uint64
}
```

The conceptual changes that affect you as a language user:

- **Groups of 8 slots with *control words***: every group has 8 contiguous control bytes (one per slot). A control byte is `10000000` (empty), `11111110` (deleted, a *tombstone*) or `0hhhhhhh`, where the 7 low hash bits (`h2`) replace the old `tophash`. On AMD64, the runtime checks the 8 bytes **in parallel with SIMD instructions**.
- **Split hash**: the 57 high bits (`h1`) locate the group through probing; the 7 low bits (`h2`) filter slots. Same idea as `tophash`, but vectorized.
- ***Load factor* 7/8**: the map grows when 7 out of every 8 slots are occupied (previously 6.5/8), with a growing directory of tables (extendible hashing) instead of the old bucket array with overflows.
- **Small map optimization**: if the map never exceeds 8 entries, it is stored in **a single group with no directory** (`dirLen == 0`).

What does **not change at all**: the language semantics, the "comma ok", the randomized iteration and — as we are about to see — the fatal error under concurrent access.

{{< /details >}}

---

## 3. The danger: unprotected concurrency

Now for the uncomfortable part. This program is all it takes to bring a service down:

```go
package main

import "sync"

func main() {
	m := map[int]int{}

	var wg sync.WaitGroup
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 1_000; j++ {
				m[j] = j // fatal error: concurrent map writes
			}
		}()
	}
	wg.Wait()
}
```

Run with Go 1.27 on my machine, the output is exactly this:

```
fatal error: concurrent map writes

goroutine 6 [running]:
internal/runtime/maps.fatal({0x7ff6bc730435?, 0x0?})
	C:/Program Files/Go/src/runtime/panic.go:1195 +0x18
main.main.func1()
	.../race/main.go:14 +0x65
created by main.main in goroutine 1
	.../race/main.go:11 +0x48
exit status 2
```

Note the critical nuance: it says **`fatal error`**, not `panic`. A `panic` in Go can be intercepted with `recover()`; a fatal error **cannot be recovered under any circumstance**: the runtime terminates the entire process with exit code 2. No `defer` will save you, no recovery *middleware* will save the pod. The runtime detector covers specific forms of concurrent misuse; it does not replace `-race` analysis or explicit synchronization.

### Why so drastic?

Because the runtime **does not lock the map** on the hot path (no `Lock`, no per-operation atomic): it does so for performance. The protection is only for **detection**, and it is based on the `writing` flag of `hmap` (formerly `hashWriting`): every write toggles the flag with XOR on entry and exit. If, on entry, the flag is found already active, the runtime knows that **another goroutine is writing at the same time** and stops the process with `fatal("concurrent map writes")`. Reads check the same flag and emit `fatal("concurrent map read and map write")`.

Why not a recoverable `panic`? Because of the internal state. Two interleaved writes can corrupt the map in ways that outlive the individual operation:

- **silently lost writes** (corrupted data that a `recover` would declare "handled"),
- **inconsistent reads** (torn memory) while `buckets`/`oldbuckets` are being mutated,
- **infinite loops** in overflow chains or in the probe sequence.

From that point on, the map stays in an undefined state **forever**, and Go's memory-safety guarantee is violated. The runtime's philosophy is *fail-fast*: better to die cleanly and restart (Kubernetes will honor `restartPolicy: Always`) than to continue with corrupted memory.

Details that surprise even veteran Go developers:

- `m[k]++` is a composed **read + write**: it also kills the process, even though you are "only incrementing".
- A **read concurrent with a write** is enough; you don't even need two writers.
- Iterating (`for k := range m`) while another goroutine writes triggers `fatal error: concurrent map iteration and map write`.
- Go's race detector (`go run -race`, `go test -race`) can detect this condition in development and CI **before** it reaches production, although that depends on the execution covering the problematic interleaving. Run your load tests with `-race`: it is a very inexpensive safety net.

{{< details title="Why doesn't the runtime synchronize maps automatically?" >}}

Three design reasons, documented in the source code itself:

1. **Performance**: most maps in real programs are not accessed concurrently (local, created and consumed within a single goroutine). Paying an atomic or a lock on *every* access would punish the majority to protect the minority. Go follows its own proverb: *"Don't pay for what you don't use"*.
2. **Composition**: an internal `Lock` does not solve the real problem, which is protecting **entire sequences** of operations (check-then-update-then-write). An atomic `sync.Map.Load` does not prevent the TOCTOU race in `if _, ok := m[k]; !ok { m[k] = v }`. You need explicit control over the *scope* of the lock, and only a mutex visible in your API gives you that.
3. **Clear and early errors**: forcing the explicit decision ("who owns this map?") produces better architectures than a false sense of safety.

{{< /details >}}

---

## 4. Solutions: sync.Mutex, sync.RWMutex and sync.Map

The golden rule: **the mutex protects the map, not the other way around**. The idiomatic way to combine them is a struct that never exposes the inner map.

### 4.1 `sync.Mutex`: the default option

```go
type SafeCounter struct {
	mu sync.Mutex
	m  map[string]int
}

func NewSafeCounter() *SafeCounter {
	return &SafeCounter{m: make(map[string]int)}
}

func (c *SafeCounter) Inc(key string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.m[key]++
}

func (c *SafeCounter) Get(key string) (int, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	v, ok := c.m[key] // the "comma ok" lives here too, inside the lock
	return v, ok
}
```

A single exclusive lock: one goroutine at a time, whether reading or writing. It is the simplest, most predictable option and — as we will see in the *benchmark* — surprisingly competitive.

### 4.2 `sync.RWMutex`: parallel readers

```go
type Cache struct {
	mu   sync.RWMutex
	data map[string][]byte
}

func (c *Cache) Get(key string) ([]byte, bool) {
	c.mu.RLock() // multiple simultaneous readers
	defer c.mu.RUnlock()
	v, ok := c.data[key]
	return v, ok
}

func (c *Cache) Set(key string, val []byte) {
	c.mu.Lock() // exclusive: blocks readers and writers
	defer c.mu.Unlock()
	c.data[key] = val
}
```

`RWMutex` allows `N` readers or `1` writer. In theory, it dominates read-heavy scenarios (>90% reads). In practice it has a trap: `RLock`/`RUnlock` are atomic operations on a **shared counter** that all 16 goroutines fight over (contention on the same *cache line*), and the mechanism that prevents writer starvation forces incoming readers to wait. The result, verified in the benchmark below: **under high contention, an `RWMutex` can be slower than a plain `Mutex`**. Don't assume: measure.

### 4.3 `sync.Map`: the special case

`sync.Map` (since Go 1.9) is a different type, not a generic replacement. Its classic implementation kept two representations: a read map (`read`) accessed **without a lock** (via atomics) and a `dirty` map protected by a mutex, with a *misses* counter that decides when to promote `dirty` to `read`. Since **Go 1.24**, the internal implementation is a **concurrent hash-trie**, with improvements that are especially visible for modifications and larger maps. The [official `sync.Map` documentation](https://pkg.go.dev/sync#Map) explicitly recommends it for two scenarios:

1. **Keys written once and read many times** (*write-once, read-many*): caches that only grow, configuration tables, immutable lookups.
2. **Goroutines that read/write/overwrite disjoint sets of keys** (no overlap).

```go
var configByTenant sync.Map // conceptually map[string]Config

func LoadConfig(tenant string) (Config, bool) {
	v, ok := configByTenant.Load(tenant) // "comma ok", sync.Map edition
	if !ok {
		return Config{}, false
	}
	return v.(Config), true // requires a type assertion: no generic typing
}

func StoreConfig(tenant string, cfg Config) {
	configByTenant.Store(tenant, cfg)
}

// LoadOrStore atomically solves the "insert if absent" pattern:
// it returns the existing value and loaded=true if it was already there.
func GetOrCreate(tenant string, mkDefault func() Config) Config {
	// mkDefault is evaluated before LoadOrStore is called. If creating the
	// value is expensive or has side effects, use a mutex or singleflight.
	v, _ := configByTenant.LoadOrStore(tenant, mkDefault())
	return v.(Config)
}
```

Its limits: the API is `map[any]any` (loss of typing, paid for with *assertions* and possible panics), it has no direct `len()`, its `Range` walks the whole map and — before Go 1.24 — it degraded noticeably when the same keys were mutated frequently. If you need type safety, wrap it with generics:

```go
type SafeMap[K comparable, V any] struct {
	mu sync.RWMutex
	m  map[K]V
}

func NewSafeMap[K comparable, V any]() *SafeMap[K, V] {
	return &SafeMap[K, V]{m: make(map[K]V)}
}

func (s *SafeMap[K, V]) Load(key K) (V, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	v, ok := s.m[key]
	return v, ok
}

func (s *SafeMap[K, V]) Store(key K, value V) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.m[key] = value
}
```

---

## 5. Comparison table: which one should I use?

### Qualitative comparison

| Strategy | Lock granularity | Read cost | Write cost | Typing | Ideal use case | When to avoid it |
|---|---|---|---|---|---|---|
| `map` + `sync.Mutex` | Whole map (exclusive) | Medium | **Low** | Full | Generic shared state, frequent writes, multi-step sequences | Massive concurrent reads (the lock becomes the bottleneck) |
| `map` + `sync.RWMutex` | Parallel readers / 1 writer | Low (in theory) | High | Full | Very read-dominant loads (>90%) with sporadic writes | Frequent writes or high contention: can perform **worse** than `Mutex` |
| `sync.Map` | Per key, *lock-free* reads | **Minimal** | Medium-high | `any` (requires assertions) | *Write-once/read-many*, append-only caches, disjoint keys per goroutine | Frequently mutated keys, need for `len()`, transactions across several keys |
| *(Bonus)* N sharded maps with mutexes | Per shard (e.g. 32 maps) | Low | Low | Full | Extreme-scale write-heavy loads | Complexity: only if the *profiler* justifies it |

### Example benchmark (Go 1.27)

Numbers measured on an Intel Core i7-11800H (8 cores / 16 threads), 1 024 keys and `GOMAXPROCS=16`. `b.RunParallel` uses the parallelism configured by `GOMAXPROCS`; therefore, the number of goroutines should not be presented as a benchmark constant. The operation mix is:

| Scenario | `Mutex` | `RWMutex` | `sync.Map` |
|---|---|---|---|
| 100% reads | 65 ns/op | 70 ns/op | **3.4 ns/op** (~20× faster) |
| 90% reads / 10% writes | **90 ns/op** | 211 ns/op | **9.6 ns/op** |
| 50% reads / 50% writes | **92 ns/op** | 227 ns/op | 32 ns/op |

Three conclusions from the table worth internalizing:

1. **`sync.Map` crushes pure reads** (~20× over `Mutex`): its read path takes no lock at all.
2. **`RWMutex` lost to `Mutex` in every scenario with contention**. The cost of the shared atomic counter and of the writer coordination outweighed the benefit of read parallelism. It is the best argument for not choosing strategies on intuition.
3. With 50% writes, `sync.Map` still holds up (thanks to the Go 1.24+ hash-trie; with the pre-1.24 implementation the write results could be worse), but the plain `Mutex` is the king of this particular mixed load.

The full benchmark code, so you can replicate it on your hardware (the absolute numbers will change; the trends, usually not):

{{< details title="Full benchmark code (bench_test.go)" >}}

```go
package bench

import (
	"sync"
	"testing"
)

const numKeys = 1024

type store interface {
	Get(k int) (int, bool)
	Set(k, v int)
}

type mutexMap struct {
	mu sync.Mutex
	m  map[int]int
}

func newMutexMap() *mutexMap { return &mutexMap{m: make(map[int]int, numKeys)} }

func (s *mutexMap) Get(k int) (int, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	v, ok := s.m[k]
	return v, ok
}

func (s *mutexMap) Set(k, v int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.m[k] = v
}

type rwMutexMap struct {
	mu sync.RWMutex
	m  map[int]int
}

func newRWMutexMap() *rwMutexMap { return &rwMutexMap{m: make(map[int]int, numKeys)} }

func (s *rwMutexMap) Get(k int) (int, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	v, ok := s.m[k]
	return v, ok
}

func (s *rwMutexMap) Set(k, v int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.m[k] = v
}

type syncMap struct{ m sync.Map }

func newSyncMap() *syncMap { return &syncMap{} }

func (s *syncMap) Get(k int) (int, bool) {
	v, ok := s.m.Load(k)
	if !ok {
		return 0, false
	}
	return v.(int), true
}

func (s *syncMap) Set(k, v int) { s.m.Store(k, v) }

// benchmarkMix runs concurrent operations with a given percentage
// of writes (0 = read-only, 50 = half and half).
func benchmarkMix(b *testing.B, s store, writePct int) {
	for i := 0; i < numKeys; i++ {
		s.Set(i, i)
	}
	b.ResetTimer()
	b.RunParallel(func(pb *testing.PB) {
		for n := 0; pb.Next(); n++ {
			k := n % numKeys
			if n%100 < writePct {
				s.Set(k, k)
			} else {
				s.Get(k)
			}
		}
	})
}

func BenchmarkReadOnly(b *testing.B) {
	b.Run("Mutex", func(b *testing.B) { benchmarkMix(b, newMutexMap(), 0) })
	b.Run("RWMutex", func(b *testing.B) { benchmarkMix(b, newRWMutexMap(), 0) })
	b.Run("SyncMap", func(b *testing.B) { benchmarkMix(b, newSyncMap(), 0) })
}

func BenchmarkRead90Write10(b *testing.B) {
	b.Run("Mutex", func(b *testing.B) { benchmarkMix(b, newMutexMap(), 10) })
	b.Run("RWMutex", func(b *testing.B) { benchmarkMix(b, newRWMutexMap(), 10) })
	b.Run("SyncMap", func(b *testing.B) { benchmarkMix(b, newSyncMap(), 10) })
}

func BenchmarkRead50Write50(b *testing.B) {
	b.Run("Mutex", func(b *testing.B) { benchmarkMix(b, newMutexMap(), 50) })
	b.Run("RWMutex", func(b *testing.B) { benchmarkMix(b, newRWMutexMap(), 50) })
	b.Run("SyncMap", func(b *testing.B) { benchmarkMix(b, newSyncMap(), 50) })
}
```

Run it with: `go test -bench . -benchtime 1s -benchmem -cpu 16` (adjust `-cpu` to your environment).

{{< /details >}}

---

## 6. Conclusions

Go's maps are a masterclass in design: a three-character API (`m[k]`) that hides a precise performance contract (amortized constant-time lookups, with hash flooding prevented by a random seed), a memory layout obsessed with the CPU cache (the `tophash` as a one-byte filter, contiguous keys and values to eliminate padding), and a deliberately *fail-fast* concurrency policy.

But that design delegates the most important decision to you, the developer: **who owns the map when more than one goroutine is watching**. The runtime does not automatically synchronize access and may terminate the process when it detects certain invalid concurrent uses. And since Go 1.24, even though the guts (`hmap`/`bmap` → Swiss Tables) have changed completely, that contract remains intact.

### Key Takeaways

1. **`v, ok := m[key]` is not optional when the zero value is ambiguous**: a missing key returns the zero value of the type, and only the boolean distinguishes "missing" from "present at zero". If your domain treats zero as data, the "comma ok" is mandatory.
2. **The lookup is a progressive filter designed for the cache**: bitmask for the bucket → `tophash` (one byte) → comparison of the real key. Contiguous keys and values avoid padding and keep locality. A map is not "an array of pairs": it is a performance machine.
3. **`fatal error: concurrent map writes` cannot be recovered**: it is not a `panic`. The runtime detects concurrency with a flag (`writing`) and prefers to die before corrupting memory. If more than one goroutine has write access, synchronize from day one, and run `go test -race` in CI.
4. **There is no universally winning strategy**: `Mutex` for simplicity and mixed loads, `RWMutex` only if reads clearly dominate (and after measuring! it can perform worse than `Mutex`), `sync.Map` for *write-once/read-many* and disjoint keys. Always encapsulate: mutex inside a struct, never expose the map.
5. **Internals are a mental model, not a language constant**: `hmap`/`bmap` described the runtime up to Go 1.23; since Go 1.24 the Swiss Tables implementation rules with a 7/8 load factor. The language semantics are stable, but measure with `pprof` and benchmarks before assuming internal costs. The figures in this article are illustrative and should be reproduced in the target environment.
