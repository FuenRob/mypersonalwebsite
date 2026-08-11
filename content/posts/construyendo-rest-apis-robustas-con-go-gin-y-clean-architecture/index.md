+++
date = '2026-08-14T10:00:00+02:00'
draft = false
title = 'Construyendo REST APIs Robustas con Go, Gin y Clean Architecture'
image = '/posts/construyendo-rest-apis-robustas-con-go-gin-y-clean-architecture/rest-api-go-header.jpg'
tags = ['Go', 'Golang', 'Gin', 'API REST', 'Clean Architecture', 'Backend']
summary = 'Aprende a estructurar y desarrollar servicios REST profesionales en Go utilizando el popular framework Gin y los principios de Arquitectura Limpia.'
+++

Al desarrollar aplicaciones backend en Go, uno de los desafíos más comunes es mantener el código organizado a medida que el proyecto crece. Sin una estructura clara, los controladores terminan acoplados directamente a la base de datos o a la lógica de negocio.

En este artículo aprenderás a diseñar una **API REST robusta en Go** combinando la velocidad del framework **Gin** con la separación de responsabilidades que ofrece la **Clean Architecture** (Arquitectura Limpia / Hexagonal).

---

## ¿Por qué Clean Architecture en Go?

La Clean Architecture promueve la independencia de frameworks, UI y bases de datos. El centro de la aplicación es siempre la **lógica de negocio (Dominio)**.

Dividimos nuestra aplicación en las siguientes capas principales:

1. **Domain (Entidades)**: Estructuras centrales del negocio e interfaces de repositorios.
2. **UseCase / Service (Lógica de negocio)**: Orquesta las reglas de la aplicación.
3. **Repository (Persistencia)**: Implementación del acceso a datos (PostgreSQL, MongoDB, etc.).
4. **Handler / Controller (HTTP con Gin)**: Recibe las peticiones HTTP, las valida y llama al caso de uso correspondiente.

---

## Estructura del Proyecto

```text
cmd/
  api/
    main.go
internal/
  domain/
    producto.go
  usecase/
    producto_usecase.go
  repository/
    producto_repository.go
  handler/
    producto_handler.go
```

---

## Paso 1: Definir las Entidades e Interfaces (Domain)

En `internal/domain/producto.go`:

```go
package domain

import "context"

type Producto struct {
	ID     string  `json:"id"`
	Nombre string  `json:"nombre"`
	Precio float64 `json:"precio"`
}

type ProductoRepository interface {
	GetByID(ctx context.Context, id string) (*Producto, error)
	Create(ctx context.Context, p *Producto) error
}

type ProductoUseCase interface {
	ObtenerProducto(ctx context.Context, id string) (*Producto, error)
	CrearProducto(ctx context.Context, p *Producto) error
}
```

---

## Paso 2: Implementar el Caso de Uso (UseCase)

En `internal/usecase/producto_usecase.go`:

```go
package usecase

import (
	"context"
	"errors"

	"mi-proyecto/internal/domain"
)

type productoUseCase struct {
	repo domain.ProductoRepository
}

func NewProductoUseCase(r domain.ProductoRepository) domain.ProductoUseCase {
	return &productoUseCase{repo: r}
}

func (u *productoUseCase) ObtenerProducto(ctx context.Context, id string) (*domain.Producto, error) {
	if id == "" {
		return nil, errors.New("ID de producto inválido")
	}
	return u.repo.GetByID(ctx, id)
}

func (u *productoUseCase) CrearProducto(ctx context.Context, p *domain.Producto) error {
	if p.Precio <= 0 {
		return errors.New("el precio debe ser mayor a cero")
	}
	return u.repo.Create(ctx, p)
}
```

---

## Paso 3: Controlador HTTP con Gin (Handler)

En `internal/handler/producto_handler.go`:

```go
package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"mi-proyecto/internal/domain"
)

type ProductoHandler struct {
	useCase domain.ProductoUseCase
}

func NewProductoHandler(r *gin.Engine, u domain.ProductoUseCase) {
	h := &ProductoHandler{useCase: u}

	api := r.Group("/api/v1")
	{
		api.GET("/productos/:id", h.GetByID)
		api.POST("/productos", h.Create)
	}
}

func (h *ProductoHandler) GetByID(c *gin.Context) {
	id := c.Param("id")
	producto, err := h.useCase.ObtenerProducto(c.Request.Context(), id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Producto no encontrado"})
		return
	}
	c.JSON(http.StatusOK, producto)
}

func (h *ProductoHandler) Create(c *gin.Context) {
	var req domain.Producto
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Petición inválida"})
		return
	}

	if err := h.useCase.CrearProducto(c.Request.Context(), &req); err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, req)
}
```

---

## Paso 4: Inyección de Dependencias en `main.go`

```go
package main

import (
	"github.com/gin-gonic/gin"
	"mi-proyecto/internal/handler"
	"mi-proyecto/internal/repository"
	"mi-proyecto/internal/usecase"
)

func main() {
	r := gin.Default()

	// Inyección de capas
	repo := repository.NewMemoryProductoRepository()
	useCase := usecase.NewProductoUseCase(repo)

	// Registrar rutas HTTP
	handler.NewProductoHandler(r, useCase)

	r.Run(":8080")
}
```

---

## Ventajas de este enfoque

- **Testabilidad**: Puedes probar tus casos de uso mockeando únicamente la interfaz `ProductoRepository`.
- **Desacoplamiento**: Si decides cambiar Gin por el router nativo `net/http` o cambiar PostgreSQL por MongoDB, la lógica del negocio no cambia en absoluto.
- **Mantenibilidad**: Estructura consistente perfecta para equipos grandes o servicios escalables.
