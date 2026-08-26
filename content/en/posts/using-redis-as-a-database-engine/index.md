+++
date = '2021-02-20T20:31:13+02:00'
draft = false
title = 'Using Redis as a Database Engine'
image = '/images/posts/usar-redis-como-motor-de-base-de-datos/usar-redis-como-motor-de-base-de-datos.png'
tags = ['Database', 'Redis', 'Software Development', 'Scalability']
summary = 'We explore the advantages and disadvantages of Redis as a database engine in software development, helping you choose the best option for your project.'
translationKey = 'using-redis-as-a-database-engine'
+++

## What is Redis?
Redis is a fast, open-source, in-memory database engine based on hash table storage (key/value) that can optionally be used as a durable or persistent database.

## Why use Redis?
Since the information is stored in memory instead of on disk, you will get faster access to the information and notice that query execution times will be shorter. Projects where you could use it and notice great results would be:
* A chat application
* A list of the most recent items, for example a list that is always shown when entering a section of the website.
* Shopping cart management on your website.
* User session storage.
* Full streaming of multimedia content.
* Support as a cache for your website.

## Code compatibility
Redis supports most of the main protocols and programming languages, including:
* Python
* Java
* PHP
* Perl
* Go
* Ruby
* C/C#/C++
* JavaScript
* Nodejs

## Drawbacks of using Redis
Bearing in mind that, by default, Redis is used to store information in memory and not on disk, the RDB persistence method consumes a lot of I/O (disk writes).

On the other hand, if what you need is to work with complex data or complex queries, Redis is not the database engine you should use.
