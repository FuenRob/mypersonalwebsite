+++
date = '2026-08-13T10:00:00+02:00'
draft = false
title = 'Mastering Generics in Go: Real Use Cases and Best Practices'
image = '/images/posts/dominando-los-generics-en-go-casos-de-uso-y-buenas-practicas/generics-go-header.jpg'
tags = ['Go', 'Golang', 'Generics', 'Programming', 'Best Practices']
summary = 'We explore in depth the generics introduced in Go 1.18. Learn how to create reusable functions and structures, constraints with interfaces and when to apply them correctly.'
translationKey = 'mastering-generics-in-go'
+++

The arrival of **Generics (generic types)** in Go 1.18 marked a milestone in the evolution of the language. After years of debate, the Go team integrated type parameterization while maintaining the simplicity, compile speed and type safety that characterize the language.

In this article we will analyze how generics work in Go, how to apply them to real software development cases, and what the best practices are to avoid overuse.

---

## Basic Syntax: Parameters and Type Constraints

In Go, generic types are specified using square brackets `[...]` in the signature of functions or structures.

### Example 1: Generic sum function with the `cmp.Ordered` or `any` constraint

```go
package main

import (
	"fmt"
)

// SumAnything works for any numeric or text type
type Numeric interface {
	~int | ~int64 | ~float64 | ~string
}

func ConcatOrSum[T Numeric](a, b T) T {
	return a + b
}

func main() {
	fmt.Println(ConcatOrSum(10, 20))             // 30
	fmt.Println(ConcatOrSum("Hello, ", "World")) // Hello, World
}
```

> **Note about the tilde (`~`)**: Using `~int` allows the generic type to also accept custom types whose underlying type is `int` (for example, `type MyInt int`).

---

## Real Use Case: Utilities for Slices and Maps

Before generics, common operations on slices (such as `Map`, `Filter` or `Reduce`) required duplicating code for each data type or losing type safety by using `interface{}` (`any`).

### Generic implementation of `Filter` and `Map`:

```go
package main

import "fmt"

// Filter filters elements of a slice based on a predicate
func Filter[T any](collection []T, predicate func(T) bool) []T {
	result := make([]T, 0)
	for _, item := range collection {
		if predicate(item) {
			result = append(result, item)
		}
	}
	return result
}

// Map transforms a slice of type T into a slice of type R
func Map[T any, R any](collection []T, transform func(T) R) []R {
	result := make([]R, len(collection))
	for i, item := range collection {
		result[i] = transform(item)
	}
	return result
}

func main() {
	numbers := []int{1, 2, 3, 4, 5, 6, 7, 8, 9, 10}

	// Filter evens
	evens := Filter(numbers, func(n int) bool {
		return n%2 == 0
	})
	fmt.Println("Evens:", evens) // [2 4 6 8 10]

	// Transform into strings
	texts := Map(evens, func(n int) string {
		return fmt.Sprintf("Number: %d", n)
	})
	fmt.Println("Strings:", texts)
}
```

---

## Generic Data Structures: The `Result[T]` Container

A very popular pattern in languages like Rust is the `Result[T]` type, which encapsulates a value or an error. With Go and generics we can build it directly:

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
	res1 := NewSuccess("Operation successful")
	if res1.IsOk() {
		fmt.Println("Value:", res1.Value)
	}
}
```

---

## When NOT to Use Generics

Although generics are powerful, **they should not replace Go's standard interfaces** when dynamic behavior is sufficient.

- **Do not use them** if you are just wrapping a common interface like `io.Reader` or `fmt.Stringer`.
- **Do not use them** to hide poor design decisions or complex hierarchies.
- **Use them** for collections, type-agnostic algorithms (slices, maps, trees, queues) and helper methods that would otherwise require repetitive type conversion.

---

## Conclusion

Generics bring enormous expressiveness to the Go ecosystem without sacrificing type safety. By applying them prudently in helper functions and data structures, you will achieve cleaner, duplication-free and easy-to-maintain code.
