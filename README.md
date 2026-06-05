# Seguimiento de control prenatal

Aplicación web estática para seguimiento operativo de controles prenatales en el marco del Programa SUMAR/SUMAR+.

La app procesa archivos en el navegador:

- reportes RISMI en Excel `.xls` o `.xlsx`;
- reportes DOM SIGEP en PDF.

No usa backend y no sube datos a un servidor. Puede publicarse en GitHub Pages.

## Uso

Abrir `index.html` en el navegador o publicarlo como sitio estático.

1. Cargar uno o varios archivos RISMI desde el panel `RISMI Excel`.
2. Cargar uno o varios PDF DOM desde el panel `DOM SIGEP PDF`.
3. Revisar indicadores, filtros, listado de embarazos y detalle del episodio.
4. Exportar CSV/XLSX si hace falta consolidar el seguimiento.

## Reglas principales

- Los controles prenatales se evalúan en rangos `0-12.9`, `13-20.9`, `21-30.9`, `31-34.9`, `35-39.9`.
- La captación temprana cuenta solo si aparece el código correspondiente en SIGEP.
- El código RISMI `1095` se marca como posible corrección solo cuando `Evolucion` contiene `EXAMEN FISICO:`.
- El estado de cumplimiento se separa de las acciones administrativas RISMI/SIGEP.

## Dependencias de navegador

La versión estática carga XLSX y PDF.js desde CDN. El procesamiento sigue siendo local en el navegador, pero la primera carga necesita acceso a esos recursos externos salvo que se vendorizen localmente.
