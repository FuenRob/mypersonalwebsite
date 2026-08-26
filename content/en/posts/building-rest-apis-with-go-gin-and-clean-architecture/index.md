+++
date = '2026-08-14T10:00:00+02:00'
draft = false
title = 'Building Robust REST APIs with Go, Gin and Clean Architecture'
image = '/images/posts/construyendo-rest-apis-robustas-con-go-gin-y-clean-architecture/rest-api-go-header.jpg'
tags = ['Go', 'Golang', 'Gin', 'REST API', 'Clean Architecture', 'Backend']
summary = 'Learn how to structure and develop professional REST services in Go using the popular Gin framework and the principles of Clean Architecture.'
translationKey = 'building-rest-apis-with-go-gin-and-clean-architecture'
+++

When developing backend applications in Go, one of the most common challenges is keeping the code organized as the project grows. Without a clear structure, controllers end up directly coupled to the database or to the business logic.

In this article you will learn how to design a **robust REST API in Go** by combining the speed of the **Gin** framework with the separation of responsibilities offered by **Clean Architecture** (Hexagonal Architecture).

---

## Why Clean Architecture in Go?

Clean Architecture promotes independence from frameworks, UI and databases. The center of the application is always the **business logic (Domain)**.

We divide our application into the following main layers:

1. **Domain (Entities)**: Core business structures and repository interfaces.
2. **UseCase / Service (Business logic)**: Orchestrates the application rules.
3. **Repository (Persistence)**: Implementation of data access (PostgreSQL, MongoDB, etc.).
4. **Handler / Controller (HTTP with Gin)**: Receives HTTP requests, validates them and calls the corresponding use case.

---

## Project Structure

```text
cmd/
  api/
    main.go
internal/
  domain/
    product.go
  usecase/
    product_usecase.go
  repository/
    product_repository.go
  handler/
    product_handler.go
```

---

## Step 1: Define Entities and Interfaces (Domain)

In `internal/domain/product.go`:

```go
package domain

import "context"

type Product struct {
	ID    string  `json:"id"`
	Name  string  `json:"name"`
	Price float64 `json:"price"`
}

type ProductRepository interface {
	GetByID(ctx context.Context, id string) (*Product, error)
	Create(ctx context.Context, p *Product) error
}

type ProductUseCase interface {
	GetProduct(ctx context.Context, id string) (*Product, error)
	CreateProduct(ctx context.Context, p *Product) error
}
```

---

## Step 2: Implement the Use Case (UseCase)

In `internal/usecase/product_usecase.go`:

```go
package usecase

import (
	"context"
	"errors"

	"my-project/internal/domain"
)

type productUseCase struct {
	repo domain.ProductRepository
}

func NewProductUseCase(r domain.ProductRepository) domain.ProductUseCase {
	return &productUseCase{repo: r}
}

func (u *productUseCase) GetProduct(ctx context.Context, id string) (*domain.Product, error) {
	if id == "" {
		return nil, errors.New("invalid product ID")
	}
	return u.repo.GetByID(ctx, id)
}

func (u *productUseCase) CreateProduct(ctx context.Context, p *domain.Product) error {
	if p.Price <= 0 {
		return errors.New("price must be greater than zero")
	}
	return u.repo.Create(ctx, p)
}
```

---

## Step 3: HTTP Controller with Gin (Handler)

In `internal/handler/product_handler.go`:

```go
package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"my-project/internal/domain"
)

type ProductHandler struct {
	useCase domain.ProductUseCase
}

func NewProductHandler(r *gin.Engine, u domain.ProductUseCase) {
	h := &ProductHandler{useCase: u}

	api := r.Group("/api/v1")
	{
		api.GET("/products/:id", h.GetByID)
		api.POST("/products", h.Create)
	}
}

func (h *ProductHandler) GetByID(c *gin.Context) {
	id := c.Param("id")
	product, err := h.useCase.GetProduct(c.Request.Context(), id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Product not found"})
		return
	}
	c.JSON(http.StatusOK, product)
}

func (h *ProductHandler) Create(c *gin.Context) {
	var req domain.Product
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	if err := h.useCase.CreateProduct(c.Request.Context(), &req); err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, req)
}
```

---

## Step 4: Dependency Injection in `main.go`

```go
package main

import (
	"github.com/gin-gonic/gin"
	"my-project/internal/handler"
	"my-project/internal/repository"
	"my-project/internal/usecase"
)

func main() {
	r := gin.Default()

	// Layer injection
	repo := repository.NewMemoryProductRepository()
	useCase := usecase.NewProductUseCase(repo)

	// Register HTTP routes
	handler.NewProductHandler(r, useCase)

	r.Run(":8080")
}
```

---

## Advantages of This Approach

- **Testability**: You can test your use cases by mocking only the `ProductRepository` interface.
- **Decoupling**: If you decide to switch Gin for the native `net/http` router or change PostgreSQL for MongoDB, the business logic does not change at all.
- **Maintainability**: A consistent structure perfect for large teams or scalable services.
