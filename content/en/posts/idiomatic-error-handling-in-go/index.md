+++
date = '2026-08-15T10:00:00+02:00'
draft = false
title = 'Idiomatic Error Handling in Go: From if err != nil to errors.Is and errors.As'
image = '/images/posts/manejo-de-errores-idiomatico-en-go/error-handling-header.jpg'
tags = ['Go', 'Golang', 'Errors', 'Best Practices', 'Backend']
summary = 'Discover the best practices for error handling in Go. From the idiomatic use of error values to unwrapping with errors.Is and errors.As.'
translationKey = 'idiomatic-error-handling-in-go'
+++

Error handling in **Go** is one of its most debated features among developers coming from exception-oriented languages such as Java, C# or Python. Instead of using `try/catch` blocks, Go treats errors as **explicit first-class values**.

In this article we will review the philosophy behind the classic `if err != nil` and learn to master the advanced functions introduced in the standard library (`fmt.Errorf`, `errors.Is` and `errors.As`).

---

## The Error Philosophy in Go

In Go, functions that can fail return the error as the last return value:

```go
func ReadFile(name string) ([]byte, error) {
	// ...
}
```

This forces the developer to inspect and make a decision about the error immediately at the site where it occurs, preventing exceptions from "flying" inadvertently up the call stack.

---

## Wrapping Errors with `%w`

We often need to add context to an error as it travels up the call chain. With `fmt.Errorf` and the `%w` verb, we can wrap the original error without losing the root cause.

```go
package main

import (
	"errors"
	"fmt"
)

var ErrDatabase = errors.New("database connection failure")

func getUser(id int) error {
	// Simulated failure
	err := ErrDatabase
	return fmt.Errorf("error getting user %d: %w", id, err)
}

func main() {
	err := getUser(42)
	fmt.Println("Error:", err)
	// Output: Error: error getting user 42: database connection failure
}
```

---

## Checking Sentinel Errors with `errors.Is`

When an error is wrapped, using the simple comparison `err == ErrDatabase` will fail. To inspect the wrapping chain correctly, use `errors.Is`:

```go
package main

import (
	"errors"
	"fmt"
)

var ErrNotFound = errors.New("resource not found")

func findRecord() error {
	return fmt.Errorf("repository layer: %w", ErrNotFound)
}

func main() {
	err := findRecord()

	// Idiomatic and safe check
	if errors.Is(err, ErrNotFound) {
		fmt.Println("The requested record does not exist!")
	}
}
```

---

## Extracting Custom Error Types with `errors.As`

If you need to access the properties of a custom error struct that has been wrapped, you must use `errors.As`.

```go
package main

import (
	"errors"
	"fmt"
)

// ValidationError is an error type with additional fields
type ValidationError struct {
	Field   string
	Message string
}

func (e *ValidationError) Error() string {
	return fmt.Sprintf("validation failed for '%s': %s", e.Field, e.Message)
}

func processForm() error {
	err := &ValidationError{Field: "Email", Message: "invalid format"}
	return fmt.Errorf("HTTP service: %w", err)
}

func main() {
	err := processForm()

	var valErr *ValidationError
	if errors.As(err, &valErr) {
		fmt.Printf("Validation error detected in field '%s': %s\n", valErr.Field, valErr.Message)
	}
}
```

---

## Golden Rules for Idiomatic Error Handling

1. **Handle errors only once**: Don't `log.Println(err)` and then also `return err`. The top level will end up duplicating the logs.
2. **Create semantic errors**: Add useful context (*"error processing payment for customer X: %w"*).
3. **Don't use `panic` for control flow**: `panic` should be reserved exclusively for unrecoverable system errors (such as failures during basic initialization).

---

## Conclusion

Treating errors as values in Go requires a change of mindset, but it produces highly predictable, readable and resilient code. Use `fmt.Errorf("%w", err)`, `errors.Is` and `errors.As` to build fail-safe systems.
