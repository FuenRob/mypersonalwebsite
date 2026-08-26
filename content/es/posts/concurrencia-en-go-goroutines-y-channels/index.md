+++
date = '2026-08-12T10:00:00+02:00'
draft = false
title = 'Concurrencia en Go: Goroutines, Channels y Patrones Avanzados'
image = '/images/posts/concurrencia-en-go-goroutines-y-channels/concurrencia-go-header.jpg'
tags = ['Go', 'Golang', 'Concurrencia', 'Goroutines', 'Channels', 'Backend']
summary = 'Aprende a dominar el modelo de concurrencia en Go. Desde conceptos básicos de goroutines y canales hasta patrones avanzados como Worker Pools y control con Context.'
translationKey = 'concurrency-in-go-goroutines-and-channels'
+++

Uno de los mayores atractivos de **Go (Golang)** es su modelo de concurrencia de primera clase, basado en los procesos secuenciales comunicados (CSP - *Communicating Sequential Processes*). A diferencia de otros lenguajes que dependen de hilos pesados del sistema operativo o complejas cadenas de *callbacks*, Go facilita la ejecución concurrente ligera y segura.

En este artículo exploraremos desde los fundamentos básicos hasta patrones de diseño avanzados para construir aplicaciones concurrentes y escalables.

---

## ¿Qué es una Goroutine?

Una **goroutine** es una función que se ejecuta de forma concurrente con otras goroutines en el mismo espacio de direcciones. Son extraordinariamente ligeras: mientras que un hilo del sistema operativo suele requerir 1-2 MB de pila, una goroutine comienza con apenas **2 KB**. Esto permite ejecutar decenas de miles de goroutines simultáneamente sin agotar la memoria.

Para iniciar una goroutine solo necesitas anteponer la palabra clave `go`:

```go
package main

import (
	"fmt"
	"time"
)

func decir(texto string) {
	for i := 0; i < 3; i++ {
		fmt.Println(texto)
		time.Sleep(100 * time.Millisecond)
	}
}

func main() {
	go decir("Hola") // Se ejecuta en segundo plano
	decir("Mundo")   // Se ejecuta en el hilo principal
}
```

---

## Comunicación segura mediante Channels

El mantra oficial del equipo de Go dice:
> *"No te comuniques compartiendo memoria; comparte memoria comunicándote."*

Los **channels** (canales) son los conductos que permiten enviar y recibir valores entre distintas goroutines, sincronizando la ejecución de forma automática.

### Ejemplo de Canal Unbuffered (Sin búfer)
Un canal sin búfer bloquea la ejecución del emisor hasta que un receptor esté listo para leer la información:

```go
package main

import "fmt"

func calcularCuadrado(numero int, ch chan int) {
	resultado := numero * numero
	ch <- resultado // Envía el resultado al canal
}

func main() {
	ch := make(chan int)

	go calcularCuadrado(5, ch)

	valor := <-ch // Recibe el valor del canal (bloqueante)
	fmt.Printf("El resultado es: %d\n", valor)
}
```

---

## Patrón Avanzado: Worker Pool

El patrón **Worker Pool** permite procesar un volumen elevado de tareas limitando el número máximo de goroutines concurrentes, evitando así la saturación de CPU o recursos externos (como bases de datos o APIs).

```go
package main

import (
	"fmt"
	"time"
)

func worker(id int, tareas <-chan int, resultados chan<- int) {
	for t := range tareas {
		fmt.Printf("Worker %d procesando tarea %d\n", id, t)
		time.Sleep(500 * time.Millisecond)
		resultados <- t * 2
	}
}

func main() {
	const numTareas = 10
	const numWorkers = 3

	tareas := make(chan int, numTareas)
	resultados := make(chan int, numTareas)

	// Crear los trabajadores
	for w := 1; w <= numWorkers; w++ {
		go worker(w, tareas, resultados)
	}

	// Enviar tareas
	for t := 1; t <= numTareas; t++ {
		tareas <- t
	}
	close(tareas) // Cerramos el canal para avisar a los workers

	// Recoger resultados
	for r := 1; r <= numTareas; r++ {
		fmt.Printf("Resultado recibido: %d\n", <-resultados)
	}
}
```

---

## Cancelación con `context.Context` y `select`

Para evitar fugas de goroutines (*goroutine leaks*), es indispensable poder cancelar tareas cuando se cumple un tiempo límite (*timeout*) o ante una señal de apagado.

```go
package main

import (
	"context"
	"fmt"
	"time"
)

func tareaLarga(ctx context.Context) {
	select {
	case <-time.After(2 * time.Second):
		fmt.Println("Tarea completada con éxito")
	case <-ctx.Done():
		fmt.Println("Tarea cancelada:", ctx.Err())
	}
}

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
	defer cancel()

	go tareaLarga(ctx)

	time.Sleep(1500 * time.Millisecond)
}
```

---

## Conclusión

La concurrencia en Go no es solo una característica técnica; es una filosofía de diseño. Al dominar las **goroutines**, **channels**, estructuras como `select` y el paquete `context`, estarás preparado para construir sistemas backend modernos, altamente concurrentes y robustos.
