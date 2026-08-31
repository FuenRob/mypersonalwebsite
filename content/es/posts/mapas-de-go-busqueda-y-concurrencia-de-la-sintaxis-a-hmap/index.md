+++
date = '2026-08-30T10:00:00+02:00'
draft = false
title = 'Búsqueda de claves y concurrencia en mapas de Go: De la sintaxis a hmap'
image = '/images/posts/mapas-de-go-busqueda-y-concurrencia-de-la-sintaxis-a-hmap/go-maps-header.jpg'
tags = ['Go', 'Golang', 'Mapas', 'Concurrencia', 'Internals', 'Rendimiento']
summary = 'Desde el modismo "comma ok" hasta la estructura hmap del runtime: cómo busca claves Go internamente, por qué los mapas no son goroutine-safe y qué estrategia de sincronización elegir entre sync.Mutex, sync.RWMutex y sync.Map.'
translationKey = 'go-maps-key-lookup-concurrency-hmap'
+++

En **Go**, el mapa (`map[K]V`) es probablemente la estructura de datos más usada en código de producción: cachés en memoria, índices de sesiones, deduplicación de mensajes, registros de servicios o *routers* de middleware. Es tan ubicuo que solemos usarlo sin preguntarnos **cómo funciona por debajo**: qué ocurre realmente en una búsqueda de clave, por qué una clave ausente devuelve el valor cero del tipo en lugar de un error, y qué demonios significa ese temido `fatal error: concurrent map writes` que tira un pod entero a las 3 de la mañana.

Este artículo hace el recorrido completo: **desde la sintaxis que escribes todos los días hasta la memoria que el runtime administra por ti**. Todos los ejemplos han sido compilados y ejecutados con Go 1.27, y el *stack trace* del error fatal que verás es real. Las cifras del benchmark son una medición concreta, no una propiedad universal: pueden variar según el hardware, el sistema operativo y la configuración de paralelismo.

---

## 1. El modismo "comma ok": por qué existe

Empecemos por la pregunta que casi nadie se hace tras años escribiendo Go: **¿cómo saber si una clave existe?**

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

	// Sin "comma ok": Go devuelve el valor cero del tipo, nunca un error.
	zero := sessions["xyz789"]
	fmt.Printf("sin comma ok: %+v\n", zero)
	// Output: sin comma ok: {UserID: TTL:0}

	// Con "comma ok": distinguimos "no existe" de "existe con valor cero".
	s, ok := sessions["xyz789"]
	if !ok {
		fmt.Println("sesión inexistente: obligamos a re-login")
	} else {
		fmt.Println("sesión encontrada:", s.UserID)
	}

	// Forma más idiomática: declarar ambas variables en el propio if.
	if s, ok := sessions["abc123"]; ok {
		fmt.Printf("sesión activa: %s (TTL %ds)\n", s.UserID, s.TTL)
	}

	// Insertar solo si la clave no existe (patrón "load or store").
	if _, ok := sessions["def456"]; !ok {
		sessions["def456"] = Session{UserID: "u-77", TTL: 60}
	}
}
```

La expresión `v, ok := m[clave]` es el famoso **"comma ok"**: una asignación múltiple donde el compilador expande la búsqueda a *dos* valores: el valor asociado a la clave y un booleano que indica si la clave estaba presente.

### ¿Por qué es necesaria?

Porque en Go **una clave ausente no es un error, es el valor cero**. A diferencia de Python (`KeyError`) o Java (`NullPointerException`/`Optional`), el diseño de Go prioriza que el acceso a un mapa nunca provoque un pánico en lectura. La consecuencia es ambigua: cuando lees `sessions["xyz789"].TTL == 0`, no sabes si la sesión existe con `TTL = 0` o si no existe.

Esto produce bugs sutiles en producción:

```go
// BUG: nunca distingue "cuota agotada (0)" de "usuario sin registro".
if quotas[userID] == 0 {
	return ErrNoQuota
}
```

```go
// CORRECTO: el booleano desambigua.
used, ok := quotas[userID]
if !ok {
	return ErrUnknownUser // la clave no existe
}
if used == 0 {
	return ErrNoQuota // existe, pero a cero
}
```

### Reglas prácticas del "comma ok"

- Si el valor cero es **semánticamente válido** para tu dominio (`map[string]bool`, contadores donde el cero no aporta información), el acceso simple `m[k]` es perfectamente idiomático.
- Si necesitas **distinguir ausencia de valor cero**, usa siempre el `ok`.
- `if _, ok := m[k]; !ok` es el patrón estándar para **insertar solo si no existe** cuando no hay acceso concurrente. Bajo concurrencia no es atómico y no equivale a `sync.Map.LoadOrStore`.
- `delete(m, k)` sobre una clave inexistente es una operación **sin efecto ni error**; no necesita comprobación previa.
- Un `map` nulo (`var m map[string]int`) es **legible** (devuelve el valor cero y `ok = false`) pero **no escribible**: `m["a"] = 1` provoca un pánico recuperable `assignment to entry in nil map`. Inicializa siempre con `make`.
- Los elementos de un mapa **no son direccionables**: `&m[k]` no compila, y tampoco puedes modificar directamente un campo de una estructura almacenada por valor (`m[k].Campo = v`). Copia el valor, modifícalo y vuelve a guardarlo; o almacena punteros si ese es el modelo de propiedad que necesitas. Un puntero a la copia no es un puntero a la entrada del mapa.

{{< details title="Ponte a prueba: ¿qué imprime este código?" >}}

```go
m := map[string]int{"a": 0}
v1, ok1 := m["a"]
v2, ok2 := m["b"]
fmt.Println(v1, ok1, v2, ok2)
```

**Opciones:** (a) `0 true 0 false`  (b) `0 false 0 false`  (c) provoca un error porque la clave `b` no existe.

**Respuesta:** la (a). La clave `"a"` existe con valor `0` (`0 true`); la clave `"b"` no existe, por lo que se devuelve el valor cero del tipo y `ok = false` (`0 false`). Este es exactamente el caso donde el booleano es imprescindible: ambos valores leídos son `0`, pero su significado es opuesto.

{{< /details >}}

---

## 2. Anatomía interna: hmap y bmap

Todo lo anterior tiene una implementación muy concreta en el runtime. Durante casi una década, la arquitectura de los mapas de Go (en `src/runtime/map.go`) se basó en **tablas hash con encadenamiento por buckets de desborde**. Entenderla es rentable: explica el coste real de una búsqueda, el uso de memoria y el comportamiento bajo crecimiento. (Si trabajas con Go 1.24 o superior, quédate hasta la sección 2.3: la implementación cambió, pero los conceptos se mantienen).

### 2.1 La cabecera: `hmap`

Cada mapa que creas es, en realidad, un puntero a esta estructura (Go 1.23, simplificada de `runtime/map.go`):

```go
type hmap struct {
	count     int    // número de elementos vivos (lo que devuelve len())
	flags     uint8  // banderas de estado (iteración, escritura en curso...)
	B         uint8  // log2 del número de buckets: hay 2^B buckets
	noverflow uint16 // número aproximado de buckets de desborde
	hash0     uint32 // semilla aleatoria del hash (por mapa y por proceso)

	buckets    unsafe.Pointer // array de 2^B buckets
	oldbuckets unsafe.Pointer // array anterior, solo durante un crecimiento
	nevacuate  uintptr        // progreso de la evacuación incremental

	extra *mapextra // estadísticas y buckets de desborde opcionales
}
```

Tres campos merecen atención especial:

- **`hash0`**: una semilla aleatoria distinta por mapa. Go la randomiza para prevenir ataques de *hash flooding* (un atacante que envía claves diseñadas para colisionar en el mismo bucket y degradar el servicio a `O(n)`). Dos mapas con las mismas claves iteran en orden distinto — esa es la razón por la que la iteración de un `map` es **deliberadamente aleatoria**.
- **`B`**: el tamaño de la tabla es siempre una potencia de dos (`2^B`), lo que permite indexar con una simple máscara de bits en lugar de un módulo.
- **`oldbuckets` / `nevacuate`**: el mecanismo de **crecimiento incremental** (más adelante).

### 2.2 El bucket: `bmap`, el arreglo `tophash` y la astucia de la caché

Cada bucket (`bmap`) almacena **exactamente 8 celdas**:

```go
// runtime/map.go (Go 1.23), estructura real:
type bmap struct {
	tophash [8]uint8 // byte alto del hash de cada clave
	// Seguido en memoria, de forma contigua, por:
	//   - 8 claves (k0..k7)
	//   - 8 valores (v0..v7)
	//   - 1 puntero a bucket de desborde (overflow)
}
```

La estructura no está completamente declarada en el código fuente: el compilador "conoce" el resto del *layout* y calcula los *offsets* de claves y valores en tiempo de compilación. En memoria, un bucket se ve así:

```
un bucket (bmap) - 8 celdas
+--------------------------------------------------+
| tophash[0..7]                8 bytes             |
+--------------------------------------------------+
| k0 | k1 | k2 | k3 | k4 | k5 | k6 | k7 |          <- 8 claves contiguas
+--------------------------------------------------+
| v0 | v1 | v2 | v3 | v4 | v5 | v6 | v7 |          <- 8 valores contiguos
+--------------------------------------------------+
| puntero al bucket de overflow                    |
+--------------------------------------------------+
```

**El arreglo `tophash`** guarda el **byte más alto del hash** de la clave alojada en cada celda. Su propósito es servir de filtro ultra barato: antes de comparar una clave candidata (que puede ser un `string` de 100 bytes), el runtime compara primero un solo byte. Si `tophash[i]` no coincide con el byte alto del hash buscado, descarta la celda **sin tocar la clave**. Si coincide, entonces sí compara la clave real con `==`. La mayoría de las veces, 8 comparaciones de un byte resuelven la búsqueda.

Cuando el byte es menor que `minTopHash` (5), no representa un hash sino un **estado de la celda**:

```go
emptyRest      = 0 // celda vacía y todas las siguientes también (permite cortar el escaneo)
emptyOne       = 1 // celda vacía
evacuatedX     = 2 // clave evacuada a la primera mitad de la tabla nueva
evacuatedY     = 3 // clave evacuada a la segunda mitad de la tabla nueva
evacuatedEmpty = 4 // celda vacía en un bucket ya evacuado
minTopHash     = 5 // a partir de aquí, es un hash real (se compensa al guardar)
```

**¿Por qué claves y valores van por separado y de forma contigua?** Dos razones de rendimiento notablemente elegantes:

1. **Eliminación del *padding***: si cada celda fuera un par clave-valor emparejado, el alineamiento de memoria obligaría a rellenar huecos. Un `map[int8]int64` clásico desperdiciaría 7 bytes por celda (8 celdas × 16 bytes = 128 bytes). Con el *layout* separado, las 8 claves ocupan 8 bytes contiguos y los 8 valores 64 bytes contiguos: **sin un solo byte de relleno**.
2. **Localidad de caché**: una búsqueda compara claves, no valores. Al estar las 8 claves juntas, escanearlas encaja en pocas *cache lines* consecutivas. Los valores, irrelevantes durante la búsqueda, no contaminan la caché con bytes que no vas a usar.

### 2.3 La búsqueda, paso a paso

Con todo lo anterior, `v, ok := m[clave]` ejecuta en el runtime (`mapaccess2`) este algoritmo:

1. Calcula `hash := Hash(clave, hash0)`.
2. Índice de bucket: `hash & (2^B - 1)` (bits **bajos** del hash).
3. Filtro rápido: `top := hash >> 56` (bits **altos**, en máquinas de 64 bits) y lo compara contra los 8 bytes de `tophash`.
4. Para cada celda con `top` coincidente, compara la clave real con `==`.
5. Si el bucket se agota, sigue la cadena de **buckets de desborde** (encadenamiento).
6. Si encuentra `emptyRest`, corta: no hay más claves que buscar.
7. Si el mapa está en medio de un crecimiento, consulta también `oldbuckets` hasta que las celdas implicadas hayan sido evacuadas.

Todo esto es lo que cuesta un `m[k]` bien dimensionado: **un hash, una máscara, unas cuantas comparaciones de un byte y una o dos comparaciones de la clave real**. Constante y baratísimo.

### 2.4 El crecimiento: evolución incremental

Cuando `count > 6.5 × 2^B` (el *load factor* clásico de Go: 13/2), o cuando se acumulan demasiados buckets de desborde, el mapa puede crecer. En el primer caso duplica `B` y asigna una tabla nueva; en el segundo puede hacer un crecimiento del mismo tamaño para reorganizar los desbordes. Pero **no copia todo de golpe** (construiría un pico de latencia fatal para un servidor): las entradas se **evacúan progresivamente** a medida que se escriben (el campo `nevacuate` marca el progreso). Durante la transición, lecturas y escrituras consultan ambas tablas, y las banderas `evacuatedX/Y` del `tophash` indican dónde vive cada clave. Los iteradores, además, empiezan por un bucket aleatorio — de ahí el orden aleatorio de `range`.

{{< details title="Go 1.24+: la era de las Swiss Tables (actualización del runtime)" open=true >}}

Si ejecutas `go version` y ves **Go 1.24 o superior**, el mapa que tienes en producción **ya no usa `hmap`/`bmap`**. El equipo de Go reescribió la implementación basándose en **Swiss Tables** (el diseño de la librería `absl` de Google), en `src/internal/runtime/maps/map.go`. Puedes ampliar esta parte en el [artículo oficial sobre Swiss Tables](https://go.dev/blog/swisstable). La estructura actual (Go 1.27) es:

```go
// src/internal/runtime/maps/map.go (Go 1.27)
type Map struct {
	used uint64 // número de elementos (len())

	seed uintptr // semilla aleatoria por mapa (como hash0)

	// Directorio de tablas. Si el mapa cabe en un solo grupo de 8
	// entradas, dirPtr apunta directamente a ese grupo (mapa pequeño).
	dirPtr unsafe.Pointer
	dirLen int

	globalDepth uint8 // bits usados para indexar el directorio
	globalShift uint8

	// Bandera de escritura en curso: se alterna con XOR para maximizar
	// la probabilidad de detectar escritores concurrentes.
	writing uint8

	tombstonePossible bool
	clearSeq          uint64
}
```

Los cambios conceptuales que te afectan como usuario del lenguaje:

- **Grupos de 8 slots con *control words***: cada grupo tiene 8 bytes de control contiguos (uno por slot). Un byte de control vale `10000000` (vacío), `11111110` (borrado, *tombstone*) o `0hhhhhhh`, donde los 7 bits bajos del hash (`h2`) sustituyen al viejo `tophash`. En AMD64, el runtime comprueba los 8 bytes **en paralelo con instrucciones SIMD**.
- **Hash dividido**: los 57 bits altos (`h1`) localizan el grupo mediante sondeo; los 7 bits bajos (`h2`) filtran slots. La idea es la misma que `tophash`, pero vectorizada.
- ***Load factor* 7/8**: el mapa crece cuando 7 de cada 8 slots están ocupados (antes 6.5/8), con directorio de tablas creciente (hashing extensible) en lugar del viejo array de buckets con desbordes.
- **Optimización de mapa pequeño**: si el mapa nunca supera 8 entradas, se almacena en **un único grupo sin directorio** (`dirLen == 0`).

Lo que **no cambia en absoluto**: la semántica del lenguaje, el "comma ok", la iteración aleatoria y, como veremos, el error fatal por concurrencia.

{{< /details >}}

---

## 3. El peligro: concurrencia sin protección

Ahora la parte incómoda. Este programa es todo lo que necesitas para tumbar un servicio:

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

Ejecutado con Go 1.27 en mi máquina, la salida es exactamente esta:

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

Fíjate en el matiz crítico: dice **`fatal error`**, no `panic`. Un `panic` en Go se puede interceptar con `recover()`; un error fatal **no se puede recuperar bajo ninguna circunstancia**: el runtime termina el proceso entero con código de salida 2. No hay `defer` que valga, no hay *middleware* de recuperación que salve al pod. El detector del runtime cubre determinados accesos concurrentes; no sustituye al análisis con `-race` ni a la sincronización explícita.

### ¿Por qué tan drástico?

Porque el runtime **no bloquea el mapa** en el camino caliente (ningún `Lock`, ningún atómico por operación): lo hace por rendimiento. La protección es solo de **detección**, y se basa en la bandera `writing` del `hmap` (antes `hashWriting`): cada escritura alterna la bandera con XOR al entrar y al salir. Si al entrar a escribir encuentra la bandera ya activa, sabe que **otra goroutine está escribiendo a la vez** y detiene el proceso con `fatal("concurrent map writes")`. Las lecturas comprueban la misma bandera y emiten `fatal("concurrent map read and map write")`.

¿Por qué no un `panic` recuperable? Por el estado interno. Dos escrituras entrelazadas pueden corromper el mapa de formas que sobreviven a la operación concreta:

- **escrituras perdidas silenciosamente** (datos corruptos que un `recover` declararía "gestionados"),
- **lecturas inconsistentes** (memoria *torn*) durante la mutación de `buckets`/`oldbuckets`,
- **bucles infinitos** en cadenas de desborde o en la secuencia de sondeo.

A partir de ahí, el mapa queda en un estado indefinido **para siempre**, y la única garantía de memoria segura de Go queda violada. La filosofía del runtime es *fail-fast*: mejor morir de forma limpia y reiniciar (Kubernetes hará el `restartPolicy: Always`) que proseguir con memoria corrupta.

Detalles que sorprenden incluso a desarrolladores con años de Go:

- `m[k]++` es **lectura + escritura** compuesta: también mata el proceso, aunque "solo incrementas".
- Una **lectura concurrente con una escritura** basta; ni siquiera hacen falta dos escritores.
- Iterar (`for k := range m`) mientras otra goroutine escribe provoca `fatal error: concurrent map iteration and map write`.
- El detector de carreras de Go (`go run -race`, `go test -race`) puede detectar esta condición en desarrollo y CI **antes** de que llegue a producción, aunque depende de que la ejecución cubra la intercalación problemática. Ejecuta tus tests de carga con `-race`: es una red de seguridad muy barata.

{{< details title="¿Por qué el runtime no sincroniza los mapas automáticamente?" >}}

Tres motivos de diseño, documentados en el propio código fuente:

1. **Rendimiento**: la mayoría de los mapas en programas reales no son accedidos concurrentemente (locales, creados y consumidos en una sola goroutine). Pagar un atómico o un lock en *cada* acceso castigaría a la mayoría para proteger a la minoría. Go sigue el principio de Go proverbio: *"Don't pay for what you don't use"*.
2. **Composición**: un `Lock` interno no resuelve el problema real, que es proteger **secuencias completas** de operaciones (comprobar-actualizar-escribir). Un `sync.Map.Load` atómico no evita la carrera TOCTOU de `if _, ok := m[k]; !ok { m[k] = v }`. Necesitas control explícito del *scope* del bloqueo, y eso solo te lo da un mutex visible en tu API.
3. **Errores claros y tempranos**: forzar la decisión explícita ("¿quién es el dueño de este mapa?") produce arquitecturas mejores que un falso sentido de seguridad.

{{< /details >}}

---

## 4. Soluciones: sync.Mutex, sync.RWMutex y sync.Map

La regla de oro: **el mutex protege al mapa, no al revés**. La forma idiomática de encapsularlos es un struct que no exponga nunca el mapa interior.

### 4.1 `sync.Mutex`: la opción por defecto

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
	v, ok := c.m[key] // el "comma ok" también vive aquí, dentro del lock
	return v, ok
}
```

Un solo cerrojo exclusivo: una goroutine a la vez, lea o escriba. Es la opción más simple, predecible y — como veremos en el *benchmark* — sorprendentemente competitiva.

### 4.2 `sync.RWMutex`: lectores en paralelo

```go
type Cache struct {
	mu   sync.RWMutex
	data map[string][]byte
}

func (c *Cache) Get(key string) ([]byte, bool) {
	c.mu.RLock() // múltiples lectores simultáneos
	defer c.mu.RUnlock()
	v, ok := c.data[key]
	return v, ok
}

func (c *Cache) Set(key string, val []byte) {
	c.mu.Lock() // exclusivo: bloquea a lectores y escritores
	defer c.mu.Unlock()
	c.data[key] = val
}
```

`RWMutex` permite `N` lectores o `1` escritor. En teoría, domina en escenarios de lectura intensiva (>90 % de lecturas). En la práctica tiene una trampa: `RLock`/`RUnlock` son operaciones atómicas sobre un **contador compartido** que los lectores disputan línea a línea (falsa contención en la misma *cache line*), y el mecanismo que impide la inanición del escritor obliga a los nuevos lectores a esperar. En el benchmark de ejemplo, **con contención alta, un `RWMutex` puede ser más lento que un `Mutex` simple**. No lo asumas: mídelo.

### 4.3 `sync.Map`: el caso especial

`sync.Map` (desde Go 1.9) es un tipo distinto, no un reemplazo genérico. Su implementación clásica mantenía dos representaciones: un mapa de lectura (`read`) accedido **sin lock** (vía atómicos) y un mapa `dirty` protegido por mutex, con una contabilidad de *misses* que decide cuándo promover `dirty` a `read`. Desde **Go 1.24**, la implementación interna es un **hash-trie concurrente**, con mejoras especialmente visibles en modificaciones y en mapas grandes. La [documentación oficial de `sync.Map`](https://pkg.go.dev/sync#Map) lo recomienda explícitamente para dos escenarios:

1. **Claves escritas una vez y leídas muchas** (*write-once, read-many*): cachés que solo crecen, tablas de configuración, *lookups* inmutables.
2. **Goroutines que leen/escriben/sobreescriben conjuntos de claves disjuntos** (sin solapamiento).

```go
var configByTenant sync.Map // map[string]Config conceptualmente

func LoadConfig(tenant string) (Config, bool) {
	v, ok := configByTenant.Load(tenant) // "comma ok", versión sync.Map
	if !ok {
		return Config{}, false
	}
	return v.(Config), true // requiere un type assertion: no hay tipado genérico
}

func StoreConfig(tenant string, cfg Config) {
	configByTenant.Store(tenant, cfg)
}

// LoadOrStore resuelve atómicamente el patrón "insertar si no existe":
// devuelve el valor existente y loaded=true si ya estaba.
func GetOrCreate(tenant string, mkDefault func() Config) Config {
	// mkDefault se evalúa antes de llamar a LoadOrStore. Si crear el valor
	// es costoso o tiene efectos secundarios, usa un mutex o singleflight.
	v, loaded := configByTenant.LoadOrStore(tenant, mkDefault())
	if loaded {
		return v.(Config)
	}
	return v.(Config) // acabamos de crearlo
}
```

Sus límites: la API es `map[any]any` (pérdida de tipado, que se paga con *assertions* y posibles pánicos), no tiene `len()` directo, su `Range` recorre todo el mapa y — antes de Go 1.24 — degradaba notablemente cuando las mismas claves se mutaban con frecuencia. Si necesitas tipado, encapsúlalo con genéricos:

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

## 5. Tabla comparativa: ¿cuál uso?

### Comparativa cualitativa

| Estrategia | Granularidad del bloqueo | Coste por lectura | Coste por escritura | Tipado | Caso de uso ideal | Cuándo evitarla |
|---|---|---|---|---|---|---|
| `map` + `sync.Mutex` | Mapa completo (exclusivo) | Media | **Baja** | Completo | Estado compartido genérico, escrituras frecuentes, secuencias multi-paso | Lecturas masivas concurrentes (el cerrojo se vuelve cuello de botella) |
| `map` + `sync.RWMutex` | Lectores en paralelo / 1 escritor | Baja (en teoría) | Alta | Completo | Lecturas muy dominantes (>90 %) con escrituras esporádicas | Escrituras frecuentes o contención alta: puede rendir **peor** que `Mutex` |
| `sync.Map` | Por clave, lecturas *lock-free* | **Mínima** | Media-alta | `any` (requiere assertions) | *Write-once/read-many*, cachés append-only, claves disjuntas por goroutine | Claves mutadas a menudo, necesidad de `len()`, transacciones sobre varias claves |
| *(Bonus)* N mapas *sharded* con mutex | Por *shard* (p. ej. 32 mapas) | Baja | Baja | Completo | Escrituras intensivas a escala extrema | Complejidad: solo si el *profiler* lo justifica |

### Ejemplo de benchmark (Go 1.27)

Números medidos en un Intel Core i7-11800H (8 núcleos / 16 hilos), 1 024 claves y `GOMAXPROCS=16`. `b.RunParallel` usa el paralelismo configurado por `GOMAXPROCS`; por tanto, no conviene presentar el número de goroutines como una constante del benchmark. La mezcla de operaciones es la siguiente:

| Escenario | `Mutex` | `RWMutex` | `sync.Map` |
|---|---|---|---|
| 100 % lecturas | 65 ns/op | 70 ns/op | **3,4 ns/op** (~20× más rápido) |
| 90 % lecturas / 10 % escrituras | **90 ns/op** | 211 ns/op | **9,6 ns/op** |
| 50 % lecturas / 50 % escrituras | **92 ns/op** | 227 ns/op | 32 ns/op |

Tres conclusiones que salen de la tabla y que conviene interiorizar:

1. **`sync.Map` arrasa en lectura pura** (~20× sobre `Mutex`): su camino de lectura no toma ningún lock.
2. **`RWMutex` perdió contra `Mutex` en todos los escenarios con contención**. El costo del atómico compartido y de la coordinación con el escritor superó el beneficio del paralelismo de lecturas. Es el mejor argumento para *no* elegir estrategias por intuición.
3. Con 50 % de escrituras, `sync.Map` sigue razonable (gracias al hash-trie de Go 1.24+; con la implementación pre-1.24 el resultado en escrituras podía ser peor), pero el `Mutex` simple es el rey de esta carga mixta concreta.

El código completo del benchmark, para que lo repliques en tu hardware (los números absolutos cambiarán; las tendencias, normalmente no):

{{< details title="Código completo del benchmark (bench_test.go)" >}}

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

// benchmarkMix ejecuta operaciones concurrentes con un porcentaje
// de escrituras dado (0 = solo lecturas, 50 = mitad y mitad).
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

Ejecuta con: `go test -bench . -benchtime 1s -benchmem -cpu 16` (ajusta `-cpu` a tu entorno).

{{< /details >}}

---

## 6. Conclusiones

Los mapas de Go son una lección magistral de diseño: una API de tres caracteres (`m[k]`) que esconde un contrato de rendimiento preciso (búsqueda en tiempo constante amortizado, con *hash flooding* prevenido por semilla aleatoria), un *layout* de memoria obsesionado con la caché de la CPU (el `tophash` como filtro de un byte, claves y valores contiguos para eliminar *padding*) y una política de concurrencia deliberadamente *fail-fast*.

Pero ese diseño delega en ti, el desarrollador, la decisión más importante: **quién es el dueño del mapa cuando hay más de una goroutine mirando**. El runtime no sincroniza automáticamente los accesos y puede terminar el proceso al detectar determinados usos concurrentes inválidos. Y desde Go 1.24, aunque las entrañas (`hmap`/`bmap` → Swiss Tables) hayan cambiado por completo, ese contrato permanece intacto.

### Key Takeaways

1. **`v, ok := m[clave]` no es opcional cuando el valor cero es ambiguo**: una clave ausente devuelve el valor cero del tipo, y solo el booleano distingue "no existe" de "existe a cero". Si tu dominio trata el cero como dato, el "comma ok" es obligatorio.
2. **La búsqueda es un filtro progresivo diseñado para la caché**: máscara de bits para el bucket → `tophash` (un byte) → comparación de la clave real. Claves y valores contiguos evitan *padding* y mantienen la localidad. El mapa no es "un array de pares": es una máquina de rendimiento.
3. **`fatal error: concurrent map writes` no se recupera**: no es un `panic`. El runtime detecta la concurrencia con una bandera (`writing`) y prefiere morir antes que corromper memoria. Si hay más de una goroutine con acceso de escritura, sincroniza desde el día uno, y ejecuta `go test -race` en CI.
4. **No hay una estrategia ganadora universal**: `Mutex` para simplicidad y cargas mixtas, `RWMutex` solo si las lecturas dominan claramente (¡y tras medir! puede rendir peor que `Mutex`), `sync.Map` para *write-once/read-many* y claves disjuntas. Encapsula siempre: mutex dentro de un struct, mapa jamás expuesto.
5. **Los internals son un modelo mental, no una constante del lenguaje**: `hmap`/`bmap` describían el runtime hasta Go 1.23; desde Go 1.24 manda la implementación de Swiss Tables con *load factor* 7/8. La semántica del lenguaje es estable, pero mide con `pprof` y *benchmarks* antes de asumir costes internos. Las cifras de este artículo son orientativas y deben reproducirse en el entorno real.
