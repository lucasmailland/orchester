# Licencias de dependencias

Resumen de licencias de las dependencias de runtime de Orchester. El objetivo es
documentar que el stack es seguro para distribución comercial / self-host, sin
licencias copyleft fuertes (AGPL/SSPL) que obliguen a abrir el código.

## Runtime deps

La gran mayoría de las dependencias de runtime usan licencias permisivas:
**MIT, Apache-2.0, ISC y BSD**. Todas permiten uso comercial, modificación y
distribución sin obligación de liberar el código fuente.

## Casos a tener en cuenta

- **`sharp`** — LGPL-3.0. Se enlaza **dinámicamente** (no se modifica ni se
  estatiza la librería), por lo que su uso es compatible con un producto de
  código cerrado. OK.
- **`jszip`** — doble licencia **MIT / GPL-3.0**. Elegimos la opción **MIT**.
  OK.

## Sin copyleft fuerte

No hay dependencias bajo **AGPL** ni **SSPL** en el árbol de runtime. Estas
licencias impondrían obligaciones de liberar código (incluso en uso de red), y
se evitan deliberadamente.

## Mantenimiento

Al agregar nuevas dependencias de runtime, verificar su licencia. Rechazar
AGPL/SSPL salvo aprobación explícita; documentar acá cualquier dependencia
LGPL o de doble licencia y la opción elegida.
