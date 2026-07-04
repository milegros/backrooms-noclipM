# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Qué es

Roguelike top-down de las Backrooms para navegador, en JavaScript vanilla + Canvas 2D, sin dependencias ni build tools (no hay `package.json`). Todo el contenido, la UI y los comentarios están en **español**; los títulos de la wiki (`Level 0`, `Faceling`) quedan en inglés.

El contenido del juego (niveles, entidades, objetos) se deriva de la wiki backrooms.fandom.com mediante un pipeline de datos en Node, y luego se cura a mano en fichas en español.

## Comandos

No hay tests ni linter. Los scripts del pipeline usan solo la stdlib de Node (requiere Node 18+ por `fetch` global).

```
node pipeline/download.js      # Fase 0: descarga la wiki → data/raw/<pageid>.json (re-ejecutable, salta lo ya descargado)
node pipeline/parse.js         # Fase 1: wikitext → data/parsed/{levels,entities,objects,others}.json + report.txt
node pipeline/select-pilot.js  # Fase 2a: elige los ~30 niveles del piloto (BFS desde Level 0 + camino de escape) → data/game/pilot-titles.json
node pipeline/make-map.js      # Fase 2b: regenera data/game/mapa-piloto.html (diagrama SVG del grafo) desde levels.es.json
node pipeline/build-data.js    # empaqueta data/game/*.es.json → game/js/data.js  ← RE-EJECUTAR tras editar cualquier ficha
```

Para jugar: abrir `game/index.html` directamente en el navegador (funciona por `file://` porque los datos van embebidos en `game/js/data.js`; no usar `fetch` de JSON en el juego por esa razón).

## Flujo de datos

```
wiki fandom → data/raw/ (crudo, 1100+ archivos, NO editar) → data/parsed/ (grafo parseado)
   → data/game/*.es.json (fichas en español CURADAS A MANO — fuente de verdad del contenido)
   → game/js/data.js (GENERADO por build-data.js — no editar a mano)
```

- `data/game/levels.es.json`, `entities.es.json`, `objects.es.json`: fichas del juego, editables. Los digests (`pilot-digest.json`, `entity-digest.json`) son resúmenes intermedios en inglés que sirvieron para redactarlas.
- Evita búsquedas amplias (grep/glob) dentro de `data/raw/` — son más de mil JSON grandes.

## Arquitectura del juego

Sin módulos ES: cada archivo de `game/js/` es un IIFE que expone un global en `window` (`RNG`, `MapGen`, `GAME_DATA`...). **El orden de los `<script>` en `game/index.html` es la gestión de dependencias** — si añades un archivo, insértalo en el orden correcto:

```
data.js → engine/rng.js → mapgen/mapgen.js → engine/tiles.js → engine/sprites.js
  → engine/effects.js → audio-manifest.js → engine/sfx.js → engine/fov.js
  → systems/entities.js → systems/rules.js → engine/render.js
  → lib/three.min.js → lib/shaders/* → lib/postprocessing/* (postpro UMD r147)
  → engine/atmos3d.js → engine/render3d.js → systems/game.js
  → ui/icons.js → ui/ui.js → ui/minimap.js → main.js
```

`audio-manifest.js` lo genera `pipeline/download-audio.js` (audios ambientales reales de la wiki
→ `game/assets/sounds/niveles/`). `sfx.js` sintetiza el resto con WebAudio (overrides en
`game/assets/sounds/`, tecla M silencia).

**Render 3D (v9, por defecto)**: `lib/three.min.js` (Three.js r147 UMD, VENDORIZADO local — única
dependencia del proyecto, aprobada por el usuario) + `engine/render3d.js` (escena por nivel con
texturas CanvasTexture reutilizando tiles/sprites/render.js→exitToCanvas; cámara Octopath ~37°,
PointLight con sombras + FogExp2; billboards). `?render=2d` usa el Canvas clásico (render.js) como
respaldo íntegro. Selftests y capturas de lógica: SIEMPRE `?render=2d&nofx=1`. Capturas 3D en
headless: `--use-angle=swiftshader` (lento). Cargar three.min.js y render3d.js tras render.js.

**Capa visual v14**: postpro con EffectComposer + UnrealBloom (threshold alto: solo florecen
materiales `toneMapped:false`) + GammaCorrection como ÚLTIMO pase (obligatorio en r147, si no la
imagen sale lavada) + ACES tone mapping; los addons UMD vienen de
`three@0.147.0/examples/js/` (r147 es la última versión con examples/js clásico).
`engine/atmos3d.js`: luminarias deterministas por bioma (tubo/colgante/farola, emisor+haz+charco
fusionados) con **pool fijo de 6 PointLights** sin sombra (nunca add/remove: evita recompilar
shaders) + polvo THREE.Points. TODO lo de postpro/atmos es no-op con `?nofx=1` (SwiftShader
headless no aguanta el bloom en dump-dom largos; capturas cortas sí). `ui/icons.js`: iconos
pixel-art de la UI (matrices 12×12) + mapa emoji→icono (`Icons.deEmoji`) + marco 9-slice en la
variable CSS `--marco`; los emojis en rules.js/textos se traducen en la UI, no en los datos.
Fuentes OFL vendorizadas en `game/assets/fonts/`. El selftest expone `luminarias` en su JSON
(-1 = NOFX). `Tiles.TILE=48` está ACOPLADO al render 2D (escala mundo→pantalla): no subirlo;
el suelo HD del 3D va en `tiles.sueloHD` (96px, rng derivado propio). Sprites: rejilla 16 ó 24
según `rows.length` (salida siempre 48px); animar con `% Sprites.frameCount(id)`, nunca `% 2`.

(Todos existen y están committeados. v3: render cenital con paredes finas autotile en `tiles.js`/`render.js`,
pixel-art data-driven en `sprites.js` con override PNG desde `game/assets/sprites/`, efectos de combate
en `effects.js`, props/contenedores registrables en `mapgen.js`/`game.js`.)

Decisiones de diseño clave:

- **Determinismo**: toda aleatoriedad de partida pasa por `RNG.create(seed)` (mulberry32); las partidas son reproducibles por semilla. No usar `Math.random()` en lógica de juego.
- **Mapas procedurales por bioma**: `MapGen.generate(levelDef, rng)` elige el arquetipo según `levelDef.bioma` (claves de `GENS` en `mapgen.js`: pasillos, garaje, tuneles, hospital, oficinas, exterior, bosque, ciudad, torres). Tiles: 0 suelo, 1 pared, 2 vacío, 3 agua, 4 suelo decorado. Todo mapa pasa por `keepLargest` (un solo componente conexo) y coloca salidas lejos del spawn vía BFS.
- **Esquema de ficha de nivel** (`levels.es.json`): `id`, `wikiTitle`, `nombre`, `clase`, `peligro` (0-5), `bioma` (debe existir en `GENS`), `tam [w,h]`, `paleta`, `vision`, `oscuridad`, `descripcion`, `cita`, `reglas[]`, `entidades [{id,n:[min,max],prob}]`, `objetos [{id,n}]`, `salidas [{texto,destino,tipo,riesgoVoid?}]`, `esEscape`, `url`, y desde v5: `estilo {pared,suelo}` (claves de los switch de `tiles.js`), `particulas` (polvo|nieve|lluvia|glitch|ojos|esporas|vapor|estrellas|null) y `sonido` (receta de `RECETAS` en sfx.js, o null si el nivel tiene audio en assets/sounds/niveles/). Tipos de salida: `normal`, `rara`, `arriesgada`, `llave`, `void`. Los `destino` referencian ids de nivel; `id` de entidades/objetos referencian sus fichas.
- **Fidelidad a la wiki**: las conexiones entre niveles, entidades por nivel y citas provienen de las páginas reales de la wiki; cada ficha conserva su `url`. Al inventar contenido nuevo, mantener coherencia con la ficha parseada correspondiente.
