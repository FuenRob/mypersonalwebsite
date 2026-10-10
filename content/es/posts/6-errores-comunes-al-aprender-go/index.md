+++
date = '2026-10-10T16:00:00+02:00'
draft = false
title = '6 Errores Comunes al Aprender Go y Cómo Evitarlos'
tags = ['Go', 'Golang', 'Buenas Prácticas', 'Backend', 'Programación']
summary = 'Seis errores habituales al empezar con Go: ignorar errores, abusar de goroutines, usar punteros sin necesidad, no entender los slices, olvidar defer y desaprovechar la biblioteca estándar.'
translationKey = 'six-common-mistakes-when-learning-go'
+++

Aprender **Go** suele ser bastante agradable al principio. La sintaxis es pequeña, el lenguaje evita muchas construcciones innecesarias y en poco tiempo puedes estar levantando una API, trabajando con JSON o ejecutando código concurrente.

Pero precisamente esa aparente sencillez puede engañar.

Muchos de los errores que cometemos al empezar con Go no tienen que ver con no conocer la sintaxis, sino con **trasladar hábitos de otros lenguajes** o utilizar ciertas características sin entender del todo qué implican.

En este artículo quiero repasar seis errores que aparecen constantemente cuando empezamos con Go y, sobre todo, cómo evitarlos.

---

## 1. Ignorar los errores

Este probablemente sea uno de los errores más fáciles de cometer.

Go trata los errores como valores, así que es perfectamente válido escribir:

```go
data, _ := os.ReadFile("config.json")
```

El problema es que estamos descartando deliberadamente la información que nos dice si la operación ha funcionado.

Si el archivo no existe, no tenemos permisos o la lectura falla, nuestro programa seguirá ejecutándose con un valor que quizá no sea válido.

La alternativa idiomática es manejar el error en el momento en el que aparece:

```go
data, err := os.ReadFile("config.json")
if err != nil {
	return fmt.Errorf("leyendo configuración: %w", err)
}
```

Esto puede parecer repetitivo, especialmente si vienes de lenguajes basados en excepciones, pero tiene una ventaja importante: **el flujo de error es explícito**.

Cuando lees una función en Go puedes ver exactamente dónde puede fallar y qué decisión toma el programa ante ese fallo.

### Regla práctica

Si estás escribiendo `_` para ignorar un error, pregúntate primero por qué puedes permitirte ignorarlo.

Hay casos legítimos, pero deberían ser una decisión consciente.

---

## 2. Crear goroutines para todo

Las goroutines son una de las características más atractivas de Go.

Crear una parece casi gratis:

```go
go procesar()
```

Y precisamente por eso es fácil abusar de ellas.

Imagina un servidor que recibe peticiones y lanza una goroutine adicional por cada operación:

```go
func handler(w http.ResponseWriter, r *http.Request) {
	go procesarPeticion(r)

	w.WriteHeader(http.StatusAccepted)
}
```

La primera pregunta debería ser:

**¿Quién controla el ciclo de vida de esa goroutine?**

¿Qué ocurre si la petición se cancela? ¿Y si `procesarPeticion` queda bloqueada? ¿Existe un límite de trabajo concurrente?

Una goroutine ligera sigue consumiendo recursos. Además, una goroutine que nunca termina puede convertirse en una **goroutine leak**.

Siempre que una goroutine dependa de una operación que pueda cancelarse, `context.Context` suele formar parte de la solución:

```go
func procesar(ctx context.Context) {
	select {
	case <-realizarTrabajo():
		fmt.Println("trabajo completado")
	case <-ctx.Done():
		fmt.Println("trabajo cancelado")
	}
}
```

### Antes de escribir `go func()`

Hazte tres preguntas:

1. ¿Cómo termina esta goroutine?
2. ¿Quién puede cancelarla?
3. ¿Qué limita el número máximo de goroutines?

Si no tienes una respuesta clara, probablemente todavía falta parte del diseño.

---

## 3. Usar punteros cuando no hacen falta

En algunos lenguajes utilizar referencias u objetos mutables es prácticamente la opción por defecto.

En Go podemos elegir explícitamente entre valores y punteros:

```go
type User struct {
	Name string
}
```

Podemos recibir un valor:

```go
func printUser(u User) {
	fmt.Println(u.Name)
}
```

O un puntero:

```go
func renameUser(u *User, name string) {
	u.Name = name
}
```

Un error común al empezar es utilizar punteros en todas partes porque pensamos que "será más eficiente".

Pero no siempre es necesario.

Los punteros añaden semántica al código:

- permiten modificar el valor original;
- pueden ser `nil`;
- introducen indirección;
- hacen que varios lugares puedan compartir el mismo estado.

Por eso la pregunta correcta no debería ser únicamente "¿es más rápido?", sino:

**¿Necesito compartir o modificar este valor?**

Para estructuras pequeñas e inmutables, trabajar por valor suele producir APIs más simples.

### Usa un puntero cuando tenga sentido

Por ejemplo, cuando:

- necesitas modificar el receptor;
- la estructura es grande y copiarla tiene un coste relevante;
- `nil` representa un estado válido;
- necesitas mantener identidad o estado compartido.

No utilices `*T` simplemente porque puedas.

---

## 4. No entender cómo funcionan los slices

Los slices parecen arrays dinámicos, pero hay una diferencia fundamental:

**un slice es una vista sobre un array subyacente**.

Eso significa que dos slices pueden compartir memoria.

Por ejemplo:

```go
numbers := []int{1, 2, 3, 4}

first := numbers[:2]
first[0] = 99

fmt.Println(numbers)
// [99 2 3 4]
```

Modificar `first` también ha modificado `numbers`.

¿Por qué?

Porque ambos slices apuntan al mismo backing array.

Esto también afecta a `append`.

Dependiendo de la capacidad disponible, `append` puede reutilizar el array existente o crear uno nuevo:

```go
a := make([]int, 2, 4)
a[0] = 1
a[1] = 2

b := append(a, 3)
```

En este caso es muy probable que `a` y `b` sigan compartiendo memoria porque había capacidad disponible.

Si necesitas una copia independiente, hazla explícitamente:

```go
copyOfNumbers := append([]int(nil), numbers...)
```

O utilizando `copy`:

```go
copyOfNumbers := make([]int, len(numbers))
copy(copyOfNumbers, numbers)
```

Entender la relación entre **puntero, longitud y capacidad** cambia completamente la forma de trabajar con slices.

---

## 5. No utilizar `defer` cuando simplifica el código

`defer` permite programar una función para que se ejecute cuando termine la función actual.

El caso clásico es cerrar un archivo:

```go
file, err := os.Open("data.txt")
if err != nil {
	return err
}
defer file.Close()
```

Esto coloca la limpieza justo al lado de la adquisición del recurso.

Sin `defer`, es fácil acabar con múltiples puntos de salida:

```go
file, err := os.Open("data.txt")
if err != nil {
	return err
}

if err := procesar(file); err != nil {
	file.Close()
	return err
}

file.Close()
return nil
```

Con `defer`:

```go
file, err := os.Open("data.txt")
if err != nil {
	return err
}
defer file.Close()

return procesar(file)
```

Mucho más fácil de razonar.

`defer` es especialmente útil para:

- cerrar archivos;
- liberar locks;
- cerrar conexiones;
- detener timers;
- ejecutar funciones de limpieza;
- cancelar contextos.

Por ejemplo:

```go
ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
defer cancel()
```

### Pero tampoco conviertas todo en `defer`

Dentro de loops muy grandes o cuando el momento exacto de liberar un recurso importa, puede ser mejor cerrar explícitamente.

La idea no es usar `defer` siempre, sino aprovecharlo cuando **hace evidente el ciclo de vida de un recurso**.

---

## 6. Buscar una dependencia antes de mirar la biblioteca estándar

Cuando venimos del ecosistema JavaScript, PHP o incluso Java, estamos acostumbrados a buscar rápidamente una librería para resolver casi cualquier problema.

En Go merece la pena cambiar ese orden.

Antes de buscar una dependencia externa, revisa la biblioteca estándar.

Go incluye paquetes muy completos para una enorme cantidad de tareas:

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
```

Para crear un servidor HTTP básico, por ejemplo, no necesitas ningún framework:

```go
package main

import (
	"fmt"
	"net/http"
)

func main() {
	http.HandleFunc("/hello", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintln(w, "Hello, Go!")
	})

	http.ListenAndServe(":8080", nil)
}
```

Esto no significa que usar frameworks o librerías externas sea malo.

Yo mismo utilizo herramientas externas cuando aportan valor.

La cuestión es evitar introducir una dependencia para solucionar algo que el propio lenguaje ya resuelve de forma sencilla.

Cada dependencia adicional tiene un coste:

- actualizaciones;
- vulnerabilidades;
- cambios incompatibles;
- mayor superficie de mantenimiento;
- más conocimiento necesario para entender el proyecto.

Por eso suelo seguir este orden:

```text
Biblioteca estándar
      ↓
¿Resuelve bien mi problema?
      ↓
Sí → úsala
No → evalúa una dependencia
```

---

## El patrón detrás de estos seis errores

Hay algo interesante en todos estos ejemplos.

El problema no suele ser que Go sea complicado.

Muchas veces ocurre exactamente lo contrario:

**intentamos complicar Go más de lo que Go quiere ser complicado.**

Creamos abstracciones antes de necesitarlas.

Lanzamos goroutines porque podemos.

Utilizamos punteros porque parecen más avanzados.

Añadimos dependencias antes de mirar lo que ya tenemos disponible.

Una de las cosas que más me gustan de Go es precisamente su tendencia hacia el código explícito.

No significa que todo proyecto Go tenga que ser trivial. Puedes construir sistemas distribuidos, plataformas de alta concurrencia y arquitecturas enormes.

Pero el lenguaje intenta que las piezas individuales sigan siendo fáciles de entender.

---

## Conclusión

Aprender Go no consiste únicamente en conseguir que el código compile.

Con el tiempo empiezas a reconocer qué decisiones encajan con la filosofía del lenguaje:

- manejar los errores explícitamente;
- controlar el ciclo de vida de las goroutines;
- utilizar punteros cuando realmente aportan algo;
- comprender la memoria compartida detrás de los slices;
- aprovechar `defer` para gestionar recursos;
- conocer la biblioteca estándar antes de añadir dependencias.

Y probablemente ahí es donde dejas de escribir simplemente código que **funciona en Go** y empiezas a escribir código que **se siente como Go**.

¿Cuál de estos errores cometiste más cuando empezaste con Go?
