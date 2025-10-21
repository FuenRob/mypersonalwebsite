# Roberto Morais - Sitio Web Personal

Este es el repositorio del sitio web personal de Roberto Morais, construido con [Hugo](https://gohugo.io/), un generador de sitios estáticos rápido y flexible escrito en Go.

## 🚀 Características

- **Framework**: Hugo (generador de sitios estáticos)
- **Tema**: Linkstree (tema personalizado)
- **Idioma**: Español (es-es)
- **Contenido**: Blog personal con artículos sobre desarrollo de software, arquitectura, Go y más

## 📋 Requisitos Previos

Antes de comenzar, asegúrate de tener instalado:

- [Hugo](https://gohugo.io/installation/)
- [Git](https://git-scm.com/)

## 🛠️ Instalación

Clona el repositorio:
```bash
git clone <url-del-repositorio>
cd mypersonalweb
```

## 🚀 Uso

### Servidor de Desarrollo

Para ejecutar el servidor de desarrollo local:

```bash
hugo server -D
```

El sitio estará disponible en `http://localhost:1313/`

La opción `-D` incluye los borradores (drafts) en la compilación.

### Crear un Nuevo Post

Para crear un nuevo artículo en el blog:

```bash
hugo new posts/titulo-del-post.md
```

O para crear un post con recursos (imágenes, etc.):

```bash
hugo new posts/titulo-del-post/index.md
```

### Construir el Sitio para Producción

Para generar los archivos estáticos del sitio:

```bash
hugo
```

Los archivos generados se encontrarán en el directorio `public/`.

Para minificar el contenido:

```bash
hugo --minify
```

## 📁 Estructura del Proyecto

```
mypersonalweb/
├── archetypes/       # Plantillas para nuevo contenido
├── assets/           # Archivos CSS, JS, imágenes sin procesar
├── content/          # Contenido del sitio (posts, páginas)
│   └── posts/        # Artículos del blog
├── data/             # Archivos de datos para plantillas
├── i18n/             # Traducciones
├── layouts/          # Plantillas HTML personalizadas
├── public/           # Sitio generado (no versionar)
├── static/           # Archivos estáticos (copiados tal cual)
├── themes/           # Temas de Hugo
│   └── linkstree/    # Tema actual
└── hugo.toml         # Archivo de configuración principal
```

## ⚙️ Configuración

El archivo de configuración principal es `hugo.toml`. Aquí puedes modificar:

- `baseURL`: La URL base del sitio
- `title`: El título del sitio
- `languageCode`: El código de idioma
- `theme`: El tema a utilizar
- Y otras opciones según las necesidades

## 📝 Contenido

Los artículos del blog se encuentran en `content/posts/`. Cada post puede ser:

- Un archivo markdown individual: `nombre-del-post.md`
- Una carpeta con recursos: `nombre-del-post/index.md` (permite incluir imágenes y otros archivos)

### Front Matter

Cada post debe incluir metadatos en la parte superior (front matter):

```toml
+++
date = '2025-10-21T16:21:42+02:00'
draft = false
title = 'Título del Post'
summary = 'Resumen breve del contenido'
tags = ['Tag1', 'Tag2', 'Tag3']
+++
```

## 🎨 Tema

Este sitio utiliza el tema **Linkstree**, ubicado en `themes/linkstree/`.

## 🚢 Despliegue

El sitio puede ser desplegado en diversas plataformas:

- **Netlify**: Conecta el repositorio y despliega automáticamente
- **Vercel**: Similar a Netlify, con despliegue automático
- **GitHub Pages**: Usando GitHub Actions
- **Cualquier servidor web**: Sube el contenido de `public/` a tu servidor

## 📚 Recursos

- [Documentación de Hugo](https://gohugo.io/documentation/)
- [Guía de inicio rápido de Hugo](https://gohugo.io/getting-started/quick-start/)
- [Hugo Themes](https://themes.gohugo.io/)

## 📄 Licencia

Este proyecto es el sitio web personal de Roberto Morais.

## 👤 Autor

**Roberto Morais**

- Sitio Web: [https://example.org/](https://example.org/)

---

Hecho con ❤️ usando Hugo

