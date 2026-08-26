+++
date = '2026-08-12T10:00:00+02:00'
draft = false
title = 'Concurrency in Go: Goroutines, Channels and Advanced Patterns'
image = '/images/posts/concurrencia-en-go-goroutines-y-channels/concurrencia-go-header.jpg'
tags = ['Go', 'Golang', 'Concurrency', 'Goroutines', 'Channels', 'Backend']
summary = 'Learn to master the concurrency model in Go. From the basics of goroutines and channels to advanced patterns such as Worker Pools and control with Context.'
translationKey = 'concurrency-in-go-goroutines-and-channels'
+++

One of the biggest attractions of **Go (Golang)** is its first-class concurrency model, based on Communicating Sequential Processes (CSP). Unlike other languages that rely on heavy operating system threads or complex callback chains, Go makes lightweight and safe concurrent execution easy.

In this article we will explore everything from the fundamentals to advanced design patterns for building concurrent and scalable applications.

---

## What is a Goroutine?

A **goroutine** is a function that runs concurrently with other goroutines in the same address space. They are extraordinarily lightweight: while an operating system thread usually requires 1-2 MB of stack, a goroutine starts with barely **2 KB**. This allows running tens of thousands of goroutines simultaneously without exhausting memory.

To start a goroutine you only need to prefix the `go` keyword:

```go
package main

import (
	"fmt"
	"time"
)

func say(text string) {
	for i := 0; i < 3; i++ {
		fmt.Println(text)
		time.Sleep(100 * time.Millisecond)
	}
}

func main() {
	go say("Hello") // Runs in the background
	say("World")    // Runs on the main thread
}
```

---

## Safe Communication via Channels

The Go team's official mantra says:
> *"Do not communicate by sharing memory; instead, share memory by communicating."*

**Channels** are the conduits that allow sending and receiving values between different goroutines, synchronizing execution automatically.

### Unbuffered Channel Example
An unbuffered channel blocks the sender's execution until a receiver is ready to read the information:

```go
package main

import "fmt"

func calculateSquare(number int, ch chan int) {
	result := number * number
	ch <- result // Sends the result to the channel
}

func main() {
	ch := make(chan int)

	go calculateSquare(5, ch)

	value := <-ch // Receives the value from the channel (blocking)
	fmt.Printf("The result is: %d\n", value)
}
```

---

## Advanced Pattern: Worker Pool

The **Worker Pool** pattern allows processing a high volume of tasks while limiting the maximum number of concurrent goroutines, thus avoiding saturation of CPU or external resources (such as databases or APIs).

```go
package main

import (
	"fmt"
	"time"
)

func worker(id int, tasks <-chan int, results chan<- int) {
	for t := range tasks {
		fmt.Printf("Worker %d processing task %d\n", id, t)
		time.Sleep(500 * time.Millisecond)
		results <- t * 2
	}
}

func main() {
	const numTasks = 10
	const numWorkers = 3

	tasks := make(chan int, numTasks)
	results := make(chan int, numTasks)

	// Create the workers
	for w := 1; w <= numWorkers; w++ {
		go worker(w, tasks, results)
	}

	// Send tasks
	for t := 1; t <= numTasks; t++ {
		tasks <- t
	}
	close(tasks) // Close the channel to notify the workers

	// Collect results
	for r := 1; r <= numTasks; r++ {
		fmt.Printf("Result received: %d\n", <-results)
	}
}
```

---

## Cancellation with `context.Context` and `select`

To avoid goroutine leaks, it is essential to be able to cancel tasks when a timeout is reached or upon a shutdown signal.

```go
package main

import (
	"context"
	"fmt"
	"time"
)

func longTask(ctx context.Context) {
	select {
	case <-time.After(2 * time.Second):
		fmt.Println("Task completed successfully")
	case <-ctx.Done():
		fmt.Println("Task cancelled:", ctx.Err())
	}
}

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
	defer cancel()

	go longTask(ctx)

	time.Sleep(1500 * time.Millisecond)
}
```

---

## Conclusion

Concurrency in Go is not just a technical feature; it is a design philosophy. By mastering **goroutines**, **channels**, structures like `select` and the `context` package, you will be ready to build modern, highly concurrent and robust backend systems.
