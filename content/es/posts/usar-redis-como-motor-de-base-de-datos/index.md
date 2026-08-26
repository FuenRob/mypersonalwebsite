+++
date = '2021-02-20T20:31:13+02:00'
draft = false
title = 'Usar Redis como motor de base de datos'
image= '/images/posts/usar-redis-como-motor-de-base-de-datos/usar-redis-como-motor-de-base-de-datos.png'
tags= ['Base de Datos', 'Redis', 'Desarrollo de Software', 'Escalabilidad']
summary= 'Exploramos las ventajas y desventajas de Redis como motor de base de datos en el desarrollo de software, ayudándote a elegir la mejor opción para tu proyecto.'
translationKey = 'using-redis-as-a-database-engine'
+++

#¿Qué es Redis?
Redis es un motor de base de datos en memoria, rápido y de código abierto, basado en el almacenamiento en tablas de hashes (clave/valor) pero que opcionalmente puede ser usada como una base de datos durable o persistente.

#¿Por qué usar Redis?
Como la información queda almacenada en memoria en lugar del disco, tendrás un acceso más rápido a la información y notarás que el tiempo de ejecución de una consulta será más corto. Los proyectos en los que se podría usar y notarías un gran resultado serían:
* Una aplicación de chat
* Listado de elementos más recientes, por ejemplo un listado que siempre se ve al entrar en una sección de la web.
* Administración de carritos de compra en tu web.
* Almacenamiento de sesiones de usuario.
* Streaming completo de contenido multimedia.
* Soporte como caché de tu página web.

#Compatibilidad de código
Redis soporta la mayoría de los principales protocolos y lenguajes de programación, incluidos:
* Python
* Java
* PHP
* Perl
* Go
* Ruby
* C/C#/C++
* JavaScript
* Nodejs

#Inconvenientes de usar Redis
Teniendo en cuenta que, por defecto, Redis se usa para guardar información en memoria y no en disco, el método de persistencia RDB consume mucho I/O (escritura en disco).

Por otro lado, si lo que necesites es trabajar con datos complejos o búsquedas complejas, Redis no es el motor de base de datos que deberías usar.
