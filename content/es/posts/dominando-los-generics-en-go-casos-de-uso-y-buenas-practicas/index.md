+++
date = '2026-08-13T10:00:00+02:00'
draft = false
title = 'Dominando los Generics en Go: Casos de Uso Reales y Buenas Prácticas'
image = '/images/posts/dominando-los-generics-en-go-casos-de-uso-y-buenas-practicas/generics-go-header.jpg'
tags = ['Go', 'Golang', 'Generics', 'Programación', 'Buenas Prácticas']
summary = 'Exploramos en profundidad los genéricos introducidos en Go 1.18. Aprende a crear funciones y estructuras reutilizables, restricciones con interfaces y cuándo aplicarlos correctamente.'
translationKey = 'mastering-generics-in-go'
+++

La llegada de los **Generics (tipos genéricos)** en Go 1.18 marcó un hito en la evolución del lenguaje. Tras años de debates, el equipo de Go integró la parametrización de tipos manteniendo la simplicidad, velocidad de compilación y seguridad de tipos que caracterizan al lenguaje.

En este artículo analizaremos cómo funcionan los genéricos en Go, cómo aplicarlos a casos reales de desarrollo de software y cuáles son las mejores prácticas para evitar el sobreuso.

---

## Sintaxis básica: Parámetros y Restricciones de Tipo

En Go, los tipos genéricos se especifican usando corchetes `[...]` en la firma de funciones o estructuras.

### Ejemplo 1: Función de suma genérica con la restricción `cmp.Ordered` o `any`

```go
package main

import (
	"fmt"
)

// SumaCualquiera funciona para cualquier tipo numérico o texto
type Numerico interface {
	~int | ~int64 | ~float64 | ~string
}

func ConcatenarOSumar[T Numerico](a, b T) T {
	return a + b
}

func main() {
	fmt.Println(ConcatenarOSumar(10, 20))             // 30
	fmt.Println(ConcatenarOSumar("Hola, ", "Mundo"))  // Hola, Mundo
}
```

> **Nota sobre la tilde (`~`)**: Indicar `~int` permite que el tipo genérico acepte también tipos personalizados cuyo tipo subyacente sea `int` (por ejemplo, `type MiEntero int`).

---

## Caso de uso real: Utilidades para Slices y Maps

Antes de los genéricos, operaciones comunes sobre slices (como `Map`, `Filter` o `Reduce`) requerían duplicar código para cada tipo de dato o perder seguridad de tipos usando `interface{}` (`any`).

### Implementación genérica de `Filter` y `Map`:

```go
package main

import "fmt"

// Filter filtra elementos de un slice basándose en un predicado
func Filter[T any](collection []T, predicate func(T) bool) []T {
	result := make([]T, 0)
	for _, item := range collection {
		if predicate(item) {
			result = append(result, item)
		}
	}
	return result
}

// Map transforma un slice de tipo T en un slice de tipo R
func Map[T any, R any](collection []T, transform func(T) R) []R {
	result := make([]R, len(collection))
	for i, item := range collection {
		result[i] = transform(item)
	}
	return result
}

func main() {
	numeros := []int{1, 2, 3, 4, 5, 6, 7, 8, 9, 10}

	// Filtrar pares
	pares := Filter(numeros, func(n int) bool {
		return n%2 == 0
	})
	fmt.Println("Pares:", pares) // [2 4 6 8 10]

	// Transformar a strings
	textos := Map(pares, func(n int) string {
		return fmt.Sprintf("Número: %d", n)
	})
	fmt.Println("Strings:", textos)
}
```

---

## Estructuras de datos genéricas: Contenedor `Result[T]`

Un patrón muy popular en lenguajes como Rust es el tipo `Result[T]`, el cual encapsula un valor o un error. Con Go y genéricos podemos construirlo de forma directa:

```go
package main

import "fmt"

type Result[T any] struct {
	Value T
	Err   error
}

func NewSuccess[T any](val T) Result[T] {
	return Result[T]{Value: val}
}

func NewError[T any](err error) Result[T] {
	return Result[T]{Err: err}
}

func (r Result[T]) IsOk() bool {
	return r.Err == nil
}

func main() {
	res1 := NewSuccess("Operación exitosa")
	if res1.IsOk() {
		fmt.Println("Valor:", res1.Value)
	}
}
```

---

## Cuándo NO usar Generics

Aunque los genéricos son potentes, **no deben reemplazar las interfaces estándar de Go** cuando el comportamiento dinámico es suficiente.

- **No los uses** si solo estás envolviendo una interfaz común como `io.Reader` o `fmt.Stringer`.
- **No los uses** para ocultar malas decisiones de diseño o jerarquías complejas.
- **Úsalos** para colecciones, algoritmos agnósticos al tipo (slices, maps, árboles, colas) y métodos helper que de otro modo requerirían conversión repetitiva de tipos.

---

## Conclusión

Los genéricos aportan una enorme expresividad al ecosistema de Go sin sacrificar la seguridad de tipos. Aplicándolos con prudencia en funciones auxiliares y estructuras de datos, lograrás un código más limpio, libre de duplicación y fácil de mantener.
