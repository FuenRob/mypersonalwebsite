+++
date = '2026-10-10T16:00:00+02:00'
draft = false
title = '6 Errores Comunes al Aprender Go y Cómo Evitarlos'
tags = ['Go', 'Buenas Prácticas', 'Backend', 'Concurrencia', 'Slices']
summary = 'Seis errores comunes al aprender Go y cómo evitarlos con ejemplos prácticos sobre errores, goroutines, punteros, slices, defer y dependencias.'
translationKey = 'six-common-mistakes-when-learning-go'
+++

Aprender **Go** suele ser bastante agradable al principio. La sintaxis es pequeña, el lenguaje evita muchas construcciones innecesarias y en poco tiempo puedes estar levantando una API, trabajando con JSON o ejecutando código concurrente.

Pero precisamente esa sencillez puede engañar.

Muchos de los errores que cometemos al empezar con Go no tienen que ver con no conocer la sintaxis, sino con **trasladar hábitos de otros lenguajes** o utilizar ciertas características sin entender del todo qué implican.

En este artículo quiero repasar seis errores que aparecen constantemente cuando empezamos con Go y, sobre todo, cómo evitarlos.

> Los ejemplos de este artículo están revisados para **Go 1.27**. Algunas APIs que aparecen aquí, como `slices.Clone` o los patrones con método en `http.ServeMux`, requieren versiones modernas de Go.

---

## 1. Ignorar los errores

Go trata los errores como valores, así que técnicamente puedes escribir algo como esto:

```go
data, _ := os.ReadFile("config.json")
```

El problema es que estás descartando deliberadamente la información que te dice si la operación ha funcionado.

Si el archivo no existe, no tienes permisos o la lectura falla, tu programa seguirá ejecutándose sin conocer la causa.

La alternativa idiomática es manejar el error en el lugar adecuado y añadir contexto cuando tenga sentido:

```go
data, err := os.ReadFile("config.json")
if err != nil {
	return fmt.Errorf("leyendo configuración: %w", err)
}
```

El verbo `%w` preserva el error original dentro de la cadena. Eso permite inspeccionarlo posteriormente con `errors.Is` y `errors.As`.

### `errors.Is`: comprobar una causa concreta

```go
if errors.Is(err, os.ErrNotExist) {
	// El archivo no existe.
}
```

### `errors.As`: extraer un tipo de error

```go
var pathErr *os.PathError

if errors.As(err, &pathErr) {
	fmt.Println("operación:", pathErr.Op)
	fmt.Println("ruta:", pathErr.Path)
}
```

Otro error frecuente es **registrar un error y devolverlo al mismo tiempo**:

```go
if err != nil {
	log.Printf("error: %v", err)
	return err
}
```

Si una capa superior también lo registra, acabarás con el mismo error repetido varias veces en los logs.

Una regla útil es:

**o manejas el error en esa capa, o añades contexto y lo devuelves.**

Si quieres profundizar en este tema, tengo otro artículo dedicado al [manejo de errores idiomático en Go](/posts/manejo-de-errores-idiomatico-en-go/).

La documentación oficial del paquete `errors` también merece tenerla cerca: [pkg.go.dev/errors](https://pkg.go.dev/errors).

---

## 2. Lanzar goroutines sin controlar su ciclo de vida

Las goroutines son una de las características más atractivas de Go.

Crear una parece casi gratis:

```go
go procesar()
```

Y precisamente por eso es fácil abusar de ellas.

Un ejemplo especialmente peligroso es este:

```go
func handler(w http.ResponseWriter, r *http.Request) {
	go procesarPeticion(r)

	w.WriteHeader(http.StatusAccepted)
}
```

Aquí no solo tenemos el problema de no saber quién controla la goroutine.

También estamos pasando un `*http.Request` a un trabajo que seguirá ejecutándose después de que el handler haya terminado. Cuando el handler retorna, el contexto de la request se cancela y su body puede cerrarse. Mantener esa request viva para trabajo asíncrono es una fuente real de bugs.

Si realmente necesitas ejecutar trabajo después de responder al cliente, lo normal es extraer los datos necesarios y enviarlos a un sistema con **ciclo de vida propio**: un worker pool, una cola o un proceso de background gestionado por la aplicación.

### Un ejemplo completo con `context.Context`

```go
package main

import (
	"context"
	"errors"
	"fmt"
	"time"
)

func procesar(ctx context.Context) error {
	select {
	case <-time.After(2 * time.Second):
		fmt.Println("trabajo completado")
		return nil

	case <-ctx.Done():
		return ctx.Err()
	}
}

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()

	err := procesar(ctx)
	if err != nil && !errors.Is(err, context.Canceled) {
		fmt.Println("proceso finalizado:", err)
	}
}
```

Ahora queda claro quién crea el contexto, quién puede cancelarlo y qué ocurre si el trabajo tarda demasiado.

### Herramientas para coordinar goroutines

Para varias goroutines sencillas, `sync.WaitGroup` permite esperar a que todas terminen:

```go
var wg sync.WaitGroup

for i := 0; i < 3; i++ {
	wg.Add(1)

	go func(id int) {
		defer wg.Done()
		fmt.Println("worker", id)
	}(i)
}

wg.Wait()
```

Si además necesitas propagar errores o cancelar el resto del trabajo cuando una goroutine falla, [`errgroup`](https://pkg.go.dev/golang.org/x/sync/errgroup) suele ser una opción más cómoda.

Y para detectar accesos concurrentes inseguros, acostúmbrate a ejecutar:

```bash
go test -race ./...
```

El detector de carreras no sustituye a un buen diseño, pero encuentra una clase de errores extremadamente difícil de detectar revisando el código a simple vista.

Antes de escribir `go func()`, hazte tres preguntas:

1. ¿Cómo termina esta goroutine?
2. ¿Quién puede cancelarla?
3. ¿Qué limita el número máximo de trabajos concurrentes?

Si no tienes una respuesta clara, probablemente todavía falta parte del diseño.

Puedes profundizar en estas ideas en mi artículo sobre [goroutines, channels y concurrencia en Go](/posts/concurrencia-en-go-goroutines-y-channels/).

---

## 3. Usar punteros pensando que siempre son más eficientes

En Go podemos elegir explícitamente entre trabajar con valores y con punteros:

```go
type User struct {
	Name string
}
```

Podemos recibir una copia del valor:

```go
func printUser(u User) {
	fmt.Println(u.Name)
}
```

O modificar el original mediante un puntero:

```go
func renameUser(u *User, name string) {
	u.Name = name
}
```

Un error común al empezar es utilizar punteros en todas partes porque pensamos que:

> "Pasar un puntero siempre será más rápido que copiar un valor."

No necesariamente.

El compilador de Go realiza **escape analysis** para decidir si un valor puede vivir en la stack o debe escapar al heap. Ciertos usos de punteros pueden contribuir a que un valor escape, lo que puede aumentar las asignaciones y la presión sobre el garbage collector.

Puedes inspeccionar parte de estas decisiones con:

```bash
go build -gcflags="-m" ./...
```

Esto no significa que los punteros sean malos. Significa que **rendimiento no debería ser la justificación automática**.

Los punteros tienen semántica:

- permiten modificar el valor original;
- pueden ser `nil`;
- hacen posible compartir estado;
- introducen indirección.

Por eso la pregunta principal debería ser:

**¿Necesito compartir identidad o modificar este valor?**

### Mantén coherentes los receivers

Si un tipo usa métodos con pointer receiver porque modifica estado, normalmente conviene mantener coherente esa decisión:

```go
func (u *User) Rename(name string) {
	u.Name = name
}

func (u *User) DisplayName() string {
	return u.Name
}
```

Mezclar arbitrariamente métodos con receiver por valor y por puntero puede hacer menos predecible la API y su method set.

### Cuidado con structs que contienen `sync.Mutex`

Este tipo no debería copiarse después de empezar a utilizarse:

```go
type Cache struct {
	mu   sync.Mutex
	data map[string]string
}
```

Copiar `Cache` copiaría también el mutex, algo que puede romper la sincronización del programa. Herramientas como `go vet` pueden detectar algunos de estos casos.

Una buena regla es utilizar punteros cuando aporten **semántica o necesidad real**, no porque parezcan una versión "más avanzada" del valor.

---

## 4. No entender el backing array de los slices

Los slices parecen arrays dinámicos, pero conceptualmente son algo distinto.

Un slice contiene tres piezas de información:

- un puntero al array subyacente;
- su longitud, `len`;
- su capacidad, `cap`.

Por eso dos slices pueden compartir el mismo **backing array**.

```go
numbers := []int{1, 2, 3, 4}

first := numbers[:2]
first[0] = 99

fmt.Println(numbers)
// [99 2 3 4]
```

`first` y `numbers` apuntan a la misma memoria.

### `append` también puede compartir el array

Observa este ejemplo:

```go
a := make([]int, 2, 4)
a[0] = 1
a[1] = 2

b := append(a, 3)

b[0] = 100

fmt.Println(a[0])
// 100
```

Aquí no es "probable" que compartan memoria: **la comparten de forma determinista**.

`a` tiene longitud 2 y capacidad 4. Añadir un tercer elemento no obliga a reservar un nuevo array, así que `append` reutiliza el existente.

### Limitar la capacidad con una full slice expression

Puedes crear un slice cuya capacidad termine exactamente donde termina su longitud:

```go
a := []int{1, 2, 3, 4}
first := a[:2:2]

extended := append(first, 99)

fmt.Println(a)
// [1 2 3 4]
```

La expresión `[:2:2]` establece longitud 2 y capacidad 2. Por tanto, `append` necesita un nuevo backing array.

### Copiar un slice con `slices.Clone`

Desde Go 1.21, una de las formas más legibles de crear una copia independiente es usar el paquete estándar `slices`:

```go
import "slices"

copyOfNumbers := slices.Clone(numbers)
```

También puedes seguir utilizando `copy`:

```go
copyOfNumbers := make([]int, len(numbers))
copy(copyOfNumbers, numbers)
```

### Un slice pequeño puede retener un array enorme

Hay otro detalle fácil de pasar por alto:

```go
big := make([]byte, 100_000_000)

small := big[:10]
```

Aunque `small` solo tiene diez bytes de longitud, sigue apuntando al array original. Mientras `small` siga vivo, el garbage collector no puede liberar ese backing array.

Si solo necesitas esos pocos bytes durante mucho tiempo, puede ser mejor copiarlos:

```go
small := slices.Clone(big[:10])
```

La explicación clásica del equipo de Go sigue siendo una gran referencia para entender este modelo: [Go Slices: usage and internals](https://go.dev/blog/slices-intro).

---

## 5. Acumular recursos con `defer` dentro de bucles

`defer` es una de las herramientas más útiles de Go porque coloca la liberación de un recurso junto al código que lo adquiere:

```go
file, err := os.Open("data.txt")
if err != nil {
	return err
}
defer file.Close()
```

Pero hay una trampa importante: un `defer` se ejecuta **cuando termina la función que lo contiene**, no al terminar la iteración del loop.

Por ejemplo:

```go
func procesarArchivos(paths []string) error {
	for _, path := range paths {
		file, err := os.Open(path)
		if err != nil {
			return err
		}

		defer file.Close()

		// procesar file...
	}

	return nil
}
```

Si recorres miles de archivos, todos ellos pueden permanecer abiertos hasta que `procesarArchivos` termine.

El problema no es principalmente el coste de `defer`, sino **la acumulación de recursos**.

Una solución sencilla consiste en mover cada iteración a una función:

```go
func procesarArchivo(path string) error {
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()

	// procesar file...

	return nil
}

func procesarArchivos(paths []string) error {
	for _, path := range paths {
		if err := procesarArchivo(path); err != nil {
			return err
		}
	}

	return nil
}
```

Ahora cada `defer file.Close()` se ejecuta al terminar `procesarArchivo`.

### `Close` también puede devolver un error

Este detalle importa especialmente al escribir archivos.

Un ejemplo como:

```go
defer file.Close()
```

ignora el error devuelto por `Close`.

Durante una escritura, algunos errores pueden aparecer precisamente al hacer flush o cerrar el archivo. Si necesitas garantizar que los datos se han persistido correctamente, debes comprobar ese error:

```go
if _, err := file.Write(data); err != nil {
	return err
}

if err := file.Close(); err != nil {
	return fmt.Errorf("cerrando archivo: %w", err)
}
```

`defer` sigue siendo excelente para cerrar recursos, desbloquear mutexes, cancelar contextos y ejecutar cleanup. Lo importante es entender **cuándo se ejecutará realmente** y si necesitas observar el error de limpieza.

---

## 6. Añadir dependencias externas por reflejo

Cuando vienes de ecosistemas como JavaScript, PHP o Java, es fácil adquirir el reflejo de buscar una librería nada más aparecer un problema.

En Go merece la pena cambiar el orden:

**primero revisa la biblioteca estándar.**

Incluye paquetes muy completos para una enorme cantidad de tareas:

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

### Un router bastante capaz sin framework

Desde Go 1.22, `http.ServeMux` permite declarar métodos y parámetros directamente en los patterns:

```go
package main

import (
	"fmt"
	"log"
	"net/http"
	"time"
)

func main() {
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

	log.Fatal(server.ListenAndServe())
}
```

Aquí hacemos dos cosas importantes:

1. **No ignoramos el error** devuelto por `ListenAndServe`.
2. Configuramos al menos `ReadHeaderTimeout`, evitando dejar un servidor sin ningún timeout configurado.

En una aplicación real también deberías valorar `ReadTimeout`, `WriteTimeout`, `IdleTimeout` y un apagado ordenado con `Server.Shutdown`, según el tipo de servicio.

La documentación de [`net/http`](https://pkg.go.dev/net/http) explica todas estas opciones.

### ¿Entonces nunca debería instalar librerías?

Claro que no.

Yo usaría una dependencia externa cuando reduzca complejidad real o aporte una capacidad que no quiero mantener por mi cuenta.

Por ejemplo:

- [`sqlc`](https://sqlc.dev/) para generar código Go type-safe a partir de SQL;
- [`testify`](https://github.com/stretchr/testify) cuando sus helpers y assertions aportan claridad a una suite de tests;
- un router externo cuando necesite características que no cubra bien `http.ServeMux`.

La diferencia está en que la dependencia sea **una decisión**, no un reflejo.

Cada dependencia adicional tiene un coste:

- actualizaciones;
- vulnerabilidades;
- cambios incompatibles;
- mayor superficie de mantenimiento;
- más conceptos que debe conocer quien entra al proyecto.

Mi orden habitual sería:

```text
Biblioteca estándar
      ↓
¿Resuelve bien el problema?
      ↓
Sí → úsala
No → evalúa una dependencia
```

---

## Herramientas que pueden detectar parte de estos problemas

No todo depende de la revisión manual.

El ecosistema de Go incluye herramientas excelentes que deberías incorporar al flujo de trabajo.

### `gofmt`

```bash
gofmt -w .
```

Elimina las discusiones sobre formato y mantiene todo el código con un estilo consistente.

### `go vet`

```bash
go vet ./...
```

Detecta construcciones sospechosas que compilan correctamente pero pueden esconder bugs, incluyendo algunos casos relacionados con copias de locks o uso incorrecto de APIs.

### Race detector

```bash
go test -race ./...
```

Es imprescindible en código concurrente para localizar data races durante la ejecución de los tests.

### `errcheck` y `golangci-lint`

[`errcheck`](https://github.com/kisielk/errcheck) ayuda a detectar errores devueltos que estás ignorando.

[`golangci-lint`](https://golangci-lint.run/) permite ejecutar múltiples analizadores de forma centralizada y suele ser una gran incorporación al CI.

Ninguna de estas herramientas sustituye a entender el lenguaje, pero convierten muchas buenas prácticas en feedback automático.

---

## El patrón detrás de estos seis errores

Hay algo interesante en todos estos casos.

El problema no suele ser que Go sea complicado.

Muchas veces ocurre exactamente lo contrario:

**intentamos complicar Go más de lo que Go quiere ser complicado.**

Lanzamos goroutines porque parecen baratas.

Utilizamos punteros porque creemos que son automáticamente más eficientes.

Tratamos los slices como si fueran listas independientes.

Añadimos dependencias antes de mirar lo que ya tenemos disponible.

O usamos una construcción correcta, como `defer`, sin comprender completamente su ciclo de vida.

Una de las cosas que más me gustan de Go es precisamente su tendencia hacia el código explícito.

Eso no significa que un proyecto Go tenga que ser trivial. Puedes construir sistemas distribuidos, servicios altamente concurrentes y arquitecturas enormes.

Pero las piezas individuales deberían seguir siendo fáciles de razonar.

---

## Conclusión

Aprender Go no consiste únicamente en conseguir que el código compile.

Con el tiempo empiezas a reconocer las decisiones que hacen que un programa sea más idiomático y mantenible:

- manejar y clasificar los errores en lugar de descartarlos;
- controlar el ciclo de vida de las goroutines;
- utilizar punteros cuando su semántica realmente lo requiere;
- comprender `len`, `cap` y el backing array de los slices;
- usar `defer` conociendo exactamente cuándo se ejecuta;
- mirar primero la biblioteca estándar antes de añadir una dependencia;
- apoyarte en herramientas como `go vet`, `gofmt` y el race detector.

Y probablemente ahí es donde dejas de escribir simplemente código que **funciona en Go** y empiezas a escribir código que **se siente como Go**.

¿Cuál de estos errores cometiste más cuando empezaste con Go?
