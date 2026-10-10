+++
date = '2026-10-10T16:00:00+02:00'
draft = false
title = '6 Common Mistakes When Learning Go and How to Avoid Them'
tags = ['Go', 'Best Practices', 'Backend', 'Concurrency', 'Slices']
summary = 'Six common mistakes when learning Go, with practical examples covering errors, goroutines, pointers, slices, defer, and dependencies.'
translationKey = 'six-common-mistakes-when-learning-go'
+++

Learning **Go** often feels pleasant at first. The syntax is small, the language avoids many unnecessary constructs, and before long you can build an API, work with JSON, or run concurrent code.

But that simplicity can be misleading.

Many mistakes we make when starting with Go have little to do with syntax. Instead, we **bring habits from other languages** or use features without fully understanding their implications.

In this article, I want to look at six mistakes that come up repeatedly when we start learning Go and, above all, how to avoid them.

> The examples in this article have been reviewed for **Go 1.27**. Some APIs used here, such as `slices.Clone` and method patterns in `http.ServeMux`, require modern versions of Go.

---

## 1. Ignoring errors

Go treats errors as values, so you can technically write something like this:

```go
data, _ := os.ReadFile("config.json")
```

The problem is that you are deliberately discarding the information that tells you whether the operation succeeded.

If the file does not exist, you lack permission, or the read fails, your program will keep running without knowing why.

The idiomatic alternative is to handle the error at the appropriate point and add context when it helps:

```go
data, err := os.ReadFile("config.json")
if err != nil {
	return fmt.Errorf("reading configuration: %w", err)
}
```

The `%w` verb wraps the original error. You can then inspect it with `errors.Is` and `errors.AsType` (or `errors.As` in older versions).

### `errors.Is`: check for a specific cause

```go
if errors.Is(err, os.ErrNotExist) {
	// The file does not exist.
}
```

### `errors.AsType`: extract an error type

Since Go 1.26, `errors.AsType[T]` returns the matching error and a boolean, without requiring a pointer to a separate target variable:

```go
if pathErr, ok := errors.AsType[*os.PathError](err); ok {
	fmt.Println("operation:", pathErr.Op)
	fmt.Println("path:", pathErr.Path)
}
```

Another common mistake is **logging an error and returning it at the same time**:

```go
if err != nil {
	log.Printf("error: %v", err)
	return err
}
```

If an upper layer logs it too, the same error appears several times in your logs.

A useful rule is: **either handle the error at this layer, or add context and return it.**

For more on this topic, see my article on [idiomatic error handling in Go](/en/posts/idiomatic-error-handling-in-go/).

The official [`errors` package documentation](https://pkg.go.dev/errors) is also worth keeping close.

---

## 2. Starting goroutines without managing their lifecycle

Goroutines are one of Go's most appealing features. Starting one seems almost free:

```go
go process()
```

That is precisely why they are easy to overuse. Here is a particularly risky example:

```go
func handler(w http.ResponseWriter, r *http.Request) {
	go processRequest(r)

	w.WriteHeader(http.StatusAccepted)
}
```

The problem is not just that nobody clearly owns the goroutine. We also pass an `*http.Request` to work that continues after the handler returns. At that point, the request context is canceled and its body may be closed. Keeping that request around for asynchronous work is a real source of bugs.

If work truly needs to continue after the response, extract the required data and hand it to a system with **its own lifecycle**: a worker pool, a queue, or a background process managed by the application.

### A complete example with `context.Context`

```go
package main

import (
	"context"
	"errors"
	"fmt"
	"time"
)

func process(ctx context.Context) error {
	select {
	case <-time.After(2 * time.Second):
		fmt.Println("work completed")
		return nil

	case <-ctx.Done():
		return ctx.Err()
	}
}

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()

	err := process(ctx)
	if err != nil {
		switch {
		case errors.Is(err, context.DeadlineExceeded):
			fmt.Println("deadline exceeded:", err)
		case errors.Is(err, context.Canceled):
			fmt.Println("work canceled:", err)
		default:
			fmt.Println("process failed:", err)
		}
	}
}
```

Now it is clear who creates the context, who can cancel it, and what happens if the work takes too long. `context.Canceled` reports cancellation; `context.DeadlineExceeded` reports an expired deadline. A timeout should not be mistaken for an explicit cancellation.

### Tools for coordinating goroutines

For several simple goroutines, `sync.WaitGroup` lets you wait until all of them finish:

```go
var wg sync.WaitGroup

for i := range 3 {
	wg.Go(func() {
		fmt.Println("worker", i)
	})
}

wg.Wait()
```

Since Go 1.25, `WaitGroup.Go` starts the goroutine and tracks its completion. The function passed to it must not panic. A `WaitGroup` does not propagate errors or cancel work. If you need to propagate errors or cancel other tasks when one fails, [`errgroup`](https://pkg.go.dev/golang.org/x/sync/errgroup) is often more convenient.

To catch unsafe concurrent access, get used to running:

```bash
go test -race ./...
```

The race detector does not replace good design, but it finds a class of bugs that is extremely hard to spot by reading code alone. It only detects races in executed code paths, so limited test coverage can leave other races undiscovered.

Before writing `go func()`, ask yourself three questions:

1. How does this goroutine finish?
2. Who can cancel it?
3. What limits the maximum number of concurrent tasks?

If you do not have clear answers, the design probably needs more work.

You can explore these ideas further in my article on [goroutines, channels, and concurrency in Go](/en/posts/concurrency-in-go-goroutines-and-channels/).

---

## 3. Assuming pointers are always more efficient

In Go, we can explicitly choose between values and pointers:

```go
type User struct {
	Name string
}
```

We can receive a copy of the value:

```go
func printUser(u User) {
	fmt.Println(u.Name)
}
```

Or modify the original through a pointer:

```go
func renameUser(u *User, name string) {
	u.Name = name
}
```

A common beginner mistake is to use pointers everywhere because we think:

> "Passing a pointer must always be faster than copying a value."

Not necessarily.

The Go compiler performs **escape analysis** to decide whether a value can live on the stack or must escape to the heap. Passing a pointer does not, by itself, imply a heap allocation, and passing by value does not guarantee that a value stays on the stack. The result depends on how the value is used and what the compiler can prove. Copying large structs also has a cost; measure it when performance matters.

You can inspect some of these decisions with:

```bash
go build -gcflags="-m" ./...
```

This does not mean pointers are bad. It means **performance should not be the automatic justification** for using them.

Pointers have semantics:

- they let you modify the original value;
- they can be `nil`;
- they allow state to be shared;
- they introduce indirection.

So the main question should be: **Do I need to share identity, modify this value, or avoid an expensive copy?**

Remember that passing a slice or map by value copies its descriptor, not all its elements. That does not make its underlying data an independent copy.

### Keep receivers consistent

If a type has pointer receiver methods because it modifies state, it is usually wise to keep that choice consistent:

```go
func (u *User) Rename(name string) {
	u.Name = name
}

func (u *User) DisplayName() string {
	return u.Name
}
```

Arbitrarily mixing value and pointer receivers can make an API and its method sets less predictable. `*User` has both sets of methods, while `User` does not include methods defined only for `*User` in its method set. That matters when satisfying interfaces.

### Be careful with structs containing `sync.Mutex`

This type should not be copied after it has been used:

```go
type Cache struct {
	mu   sync.Mutex
	data map[string]string
}
```

Copying `Cache` would copy the mutex too, potentially breaking synchronization. Tools such as `go vet` can catch some of these cases.

A good rule is to use pointers when they serve a **real semantic or practical need**, not because they look like a more advanced version of a value.

---

## 4. Misunderstanding the backing array of slices

Slices look like dynamic arrays, but they are conceptually different. A slice contains three pieces of information:

- a pointer to the underlying array;
- its length, `len`;
- its capacity, `cap`.

That is why two slices can share the same **backing array**.

```go
numbers := []int{1, 2, 3, 4}

first := numbers[:2]
first[0] = 99

fmt.Println(numbers)
// [99 2 3 4]
```

`first` and `numbers` refer to the same storage.

### `append` may also share the array

Consider this example:

```go
a := make([]int, 2, 4)
a[0] = 1
a[1] = 2

b := append(a, 3)

b[0] = 100

fmt.Println(a[0])
// 100
```

Here, sharing is not merely likely: **it is guaranteed**. `a` has length 2 and capacity 4. Adding a third element does not require a new array, so `append` reuses the existing one.

### Limit capacity with a full slice expression

You can create a slice whose capacity ends exactly where its length ends:

```go
a := []int{1, 2, 3, 4}
first := a[:2:2]

extended := append(first, 99)

fmt.Println(a)
// [1 2 3 4]
```

The expression `[:2:2]` sets both length and capacity to 2. As a result, `append` needs a new backing array.

### Copy a slice with `slices.Clone`

Since Go 1.21, one readable way to create an independent copy is the standard library's `slices` package:

```go
import "slices"

copyOfNumbers := slices.Clone(numbers)
```

You can still use `copy`:

```go
copyOfNumbers := make([]int, len(numbers))
copy(copyOfNumbers, numbers)
```

### A small slice can retain a huge array

Here is another easy detail to miss:

```go
big := make([]byte, 100_000_000)

small := big[:10]
```

Although `small` is only ten bytes long, it still points into the original array. While `small` remains live, the garbage collector cannot release that backing array.

If you need only those few bytes for a long time, copying them may be better:

```go
small := slices.Clone(big[:10])
```

The Go team's classic explanation remains an excellent reference: [Go Slices: usage and internals](https://go.dev/blog/slices-intro).

---

## 5. Accumulating resources with `defer` inside loops

`defer` is one of Go's most useful tools because it places cleanup next to resource acquisition:

```go
file, err := os.Open("data.txt")
if err != nil {
	return err
}
defer file.Close()
```

But there is an important catch: a `defer` runs **when its surrounding function returns**, not at the end of a loop iteration.

For example:

```go
func processFiles(paths []string) error {
	for _, path := range paths {
		file, err := os.Open(path)
		if err != nil {
			return err
		}

		defer file.Close()

		// Process file...
	}

	return nil
}
```

If you iterate over thousands of files, they can all remain open until `processFiles` returns. The main issue is not the cost of `defer` itself, but **resource accumulation**.

A simple solution is to move each iteration into a function:

```go
func processFile(path string) error {
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()

	// Process file...

	return nil
}

func processFiles(paths []string) error {
	for _, path := range paths {
		if err := processFile(path); err != nil {
			return err
		}
	}

	return nil
}
```

Now each `defer file.Close()` runs when `processFile` returns.

### `Close` can also return an error

This matters especially when writing files. An unchecked `defer file.Close()` discards possible close errors. You should also avoid leaving an open file behind if `Write` or `Sync` fails.

If you need to request that data be synchronized with storage, check `Write`, `Sync`, and `Close`, and preserve both the main error and any close error:

```go
func save(path string, data []byte) (err error) {
	file, err := os.Create(path)
	if err != nil {
		return fmt.Errorf("creating file: %w", err)
	}
	defer func() {
		if closeErr := file.Close(); closeErr != nil {
			err = errors.Join(err, fmt.Errorf("closing file: %w", closeErr))
		}
	}()

	if _, err := file.Write(data); err != nil {
		return fmt.Errorf("writing file: %w", err)
	}
	if err := file.Sync(); err != nil {
		return fmt.Errorf("syncing file: %w", err)
	}
	return nil
}
```

`Sync` may be necessary when durability matters, but its exact guarantee depends on the file system and storage device. Atomically and durably replacing a file requires additional steps. For ordinary reads, closing with `defer` is usually enough. The key is to know **when cleanup runs** and when you need to observe its error.

---

## 6. Adding external dependencies by reflex

If you come from ecosystems such as JavaScript, PHP, or Java, it is easy to look for a library as soon as you encounter a problem.

In Go, it is worth changing the order: **check the standard library first.**

It has capable packages for a wide range of tasks:

```text
net/http
encoding/json
context
sync
testing
log/slog
crypto/*
database/sql
html/template
flag
regexp
time
slices
maps
```

### A capable router without a framework

Since Go 1.22, `http.ServeMux` supports methods and path parameters directly in its patterns:

```go
package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func main() {
	if err := runServer(); err != nil {
		log.Fatal(err)
	}
}

func runServer() error {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /users/{id}", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		fmt.Fprintf(w, "user: %s\n", id)
	})

	server := &http.Server{
		Addr:              ":8080",
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	serveErr := make(chan error, 1)
	go func() { serveErr <- server.ListenAndServe() }()

	select {
	case err := <-serveErr:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return fmt.Errorf("HTTP server: %w", err)
	case <-ctx.Done():
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	shutdownErr := server.Shutdown(shutdownCtx)
	if err := <-serveErr; !errors.Is(err, http.ErrServerClosed) {
		return errors.Join(shutdownErr, fmt.Errorf("HTTP server: %w", err))
	}
	return shutdownErr
}
```

This checks the error from `ListenAndServe` and waits for `Shutdown` before exiting. If shutdown fails or reaches its deadline, the error reaches `main` and the process exits with a failure status. After a graceful shutdown, `ListenAndServe` returns `http.ErrServerClosed`: that is expected, not a fatal error. `ReadHeaderTimeout` limits how long header reading can take. Depending on the service, also consider `ReadTimeout`, `WriteTimeout`, and `IdleTimeout`. These limits have different effects, for example on long requests or responses, so choose them for the actual workload. `Shutdown` waits for active HTTP connections until its context expires, but does not wait for hijacked connections such as WebSockets; those need their own shutdown procedure.

The [`net/http` documentation](https://pkg.go.dev/net/http) explains these options.

### So should I never install libraries?

Of course you should when they help. I would add an external dependency when it genuinely reduces complexity or provides a capability I do not want to maintain myself.

For example:

- [`sqlc`](https://sqlc.dev/) generates type-safe Go code from SQL;
- [`testify`](https://github.com/stretchr/testify) can make a test suite clearer with its helpers and assertions;
- an external router may be useful when `http.ServeMux` does not cover your requirements well.

The point is to make the dependency **a decision, not a reflex**.

Every additional dependency has a cost:

- updates;
- vulnerabilities;
- breaking changes;
- more maintenance work;
- more concepts for new contributors to learn.

My usual order is:

```text
Standard library
      ↓
Does it solve the problem well?
      ↓
Yes → use it
No → evaluate a dependency
```

---

## Tools that can catch some of these problems

Manual review is not your only option. Go has excellent tools worth adding to your workflow.

### `go fmt` and `go fix`

```bash
go fmt ./...
go fix -diff ./...
go fix ./...
```

`go fmt` applies `gofmt` to the selected packages and keeps formatting consistent. `go fix -diff` previews the proposed changes without applying them; if they look right, `go fix` applies available source updates for the project's Go version. Review the diff afterward as well, because it can rewrite files. For one specific file, you can also use `gofmt -w file.go`.

### `go vet`

```bash
go vet ./...
```

It finds suspicious constructs that compile but may hide bugs, including some lock copies and incorrect API usage.

### Race detector

```bash
go test -race ./...
```

It helps find data races while running tests in concurrent code, but only in the paths those tests exercise. For broader coverage, you can also run a program built with `-race` under a representative workload.

### `errcheck` and `golangci-lint`

[`errcheck`](https://github.com/kisielk/errcheck) helps catch returned errors that you ignore.

[`golangci-lint`](https://golangci-lint.run/) runs multiple analyzers centrally and can be a useful addition to CI.

None of these tools replaces understanding the language, but they turn many good practices into automated feedback.

---

## The pattern behind these six mistakes

There is a common thread here. The problem is rarely that Go is complicated. Often, **we make Go more complicated than it needs to be.**

We start goroutines because they seem cheap. We use pointers because we assume they are automatically faster. We treat slices as independent lists. We add dependencies before checking what is already available. Or we use a valid construct such as `defer` without fully understanding its lifecycle.

One of the things I like most about Go is its preference for explicit code.

That does not mean a Go project must be trivial. You can build distributed systems, highly concurrent services, and large architectures. But the individual pieces should remain easy to reason about.

---

## Conclusion

Learning Go is not just about making code compile. Over time, you start to recognize the choices that make a program more idiomatic and maintainable:

- handle and classify errors instead of discarding them;
- control the lifecycle of goroutines;
- use pointers when their semantics call for them;
- understand `len`, `cap`, and the backing array of slices;
- use `defer` knowing exactly when it runs;
- check the standard library before adding a dependency;
- use tools such as `go fmt`, `go fix`, `go vet`, and the race detector.

That is probably when you stop merely writing code that **works in Go** and start writing code that **feels like Go**.
