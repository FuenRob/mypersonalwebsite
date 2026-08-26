+++
date = '2026-08-15T10:00:00+02:00'
draft = false
title = 'Manejo de Errores Idiomático en Go: De if err != nil a errors.Is y errors.As'
image = '/images/posts/manejo-de-errores-idiomatico-en-go/error-handling-header.jpg'
tags = ['Go', 'Golang', 'Errores', 'Buenas Prácticas', 'Backend']
summary = 'Descubre las mejores prácticas para el tratamiento de errores en Go. Desde el uso idiomático de valores de error hasta el desempaquetado con errors.Is y errors.As.'
translationKey = 'idiomatic-error-handling-in-go'
+++

El manejo de errores en **Go** es una de sus características más debatidas por desarrolladores procedentes de lenguajes orientados a excepciones como Java, C# o Python. En lugar de usar bloques `try/catch`, Go trata los errores como **valores explícitos de primera clase**.

En este artículo repasaremos la filosofía tras el clásico `if err != nil` y aprenderemos a dominar las funciones avanzadas introducidas en la librería estándar (`fmt.Errorf`, `errors.Is` y `errors.As`).

---

## La Filosofía de Errores en Go

En Go, las funciones que pueden fallar devuelven el error como último valor de retorno:

```go
func LeerArchivo(nombre string) ([]byte, error) {
	// ...
}
```

Esto obliga al desarrollador a inspeccionar y tomar una decisión sobre el error inmediatamente en el sitio donde ocurre, evitando que las excepciones "vuelen" inadvertidamente por la pila de llamadas.

---

## Envolviendo Errores (*Error Wrapping*) con `%w`

A menudo necesitamos agregar contexto a un error a medida que sube por la cadena de llamadas. Con `fmt.Errorf` y el verbo `%w`, podemos envolver el error original sin perder la causa raíz.

```go
package main

import (
	"errors"
	"fmt"
)

var ErrBaseDeDatos = errors.New("fallo en la conexión a la base de datos")

func consultarUsuario(id int) error {
	// Simulación de fallo
	err := ErrBaseDeDatos
	return fmt.Errorf("error al obtener usuario %d: %w", id, err)
}

func main() {
	err := consultarUsuario(42)
	fmt.Println("Error:", err)
	// Output: Error: error al obtener usuario 42: fallo en la conexión a la base de datos
}
```

---

## Comprobar Errores Sentinela con `errors.Is`

Cuando un error está envuelto, usar la comparación simple `err == ErrBaseDeDatos` fallará. Para inspeccionar la cadena de envoltorios correctamente se utiliza `errors.Is`:

```go
package main

import (
	"errors"
	"fmt"
)

var ErrNoEncontrado = errors.New("recurso no encontrado")

func buscarRegistro() error {
	return fmt.Errorf("capa de repositorio: %w", ErrNoEncontrado)
}

func main() {
	err := buscarRegistro()

	// Comprobación idiomática y segura
	if errors.Is(err, ErrNoEncontrado) {
		fmt.Println("¡El registro solicitado no existe!")
	}
}
```

---

## Extraer Tipos de Error Personalizados con `errors.As`

Si necesitas acceder a las propiedades de un struct de error personalizado que ha sido envuelto, debes utilizar `errors.As`.

```go
package main

import (
	"errors"
	"fmt"
)

// ValidationError es un tipo de error con campos adicionales
type ValidationError struct {
	Campo   string
	Mensaje string
}

func (e *ValidationError) Error() string {
	return fmt.Sprintf("validación fallida en '%s': %s", e.Campo, e.Mensaje)
}

func procesarFormulario() error {
	err := &ValidationError{Campo: "Email", Mensaje: "formato inválido"}
	return fmt.Errorf("servicio HTTP: %w", err)
}

func main() {
	err := procesarFormulario()

	var valErr *ValidationError
	if errors.As(err, &valErr) {
		fmt.Printf("Error de validación detectado en el campo '%s': %s\n", valErr.Campo, valErr.Mensaje)
	}
}
```

---

## Reglas de Oro para un Manejo de Errores Idiomático

1. **Maneja los errores solo una vez**: No hagas `log.Println(err)` y además retornes `return err`. El nivel superior terminará duplicando los registros.
2. **Crea errores semánticos**: Agrega contexto útil (*"error al procesar pago del cliente X: %w"*).
3. **No uses `panic` para el flujo de control**: `panic` debe reservarse exclusivamente para errores irrecuperables del sistema (como fallos en la inicialización básica).

---

## Conclusión

Tratar los errores como valores en Go requiere un cambio de mentalidad, pero produce código highly predecible, legible y resiliente. Utiliza `fmt.Errorf("%w", err)`, `errors.Is` y `errors.As` para construir sistemas a prueba de fallos.
