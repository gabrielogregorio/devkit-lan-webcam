## CellCam

Transforma a câmera do **celular** numa **webcam virtual no PC** (Ubuntu). O celular
abre uma página web servida pelo PC, captura a câmera e envia os frames; no PC eles
viram um dispositivo `/dev/video10` que apps (Chrome, Zoom, OBS, Meet…) enxergam como
a câmera **"Phone Camera"**.

Ambiente onde foi montado: Ubuntu, kernel 6.17

## Arquitetura / fluxo

```
[Celular] getUserMedia → canvas → JPEG (~25fps)
   │  WebSocket (wss, binário)
   ▼
[PC] server.py (aiohttp, HTTPS porta 9443)
   │  escreve os JPEGs no stdin do ffmpeg
   ▼
[ffmpeg]  -f mjpeg -i pipe:0 → scale/yuv420p → -f v4l2 /dev/video10
   ▼
[v4l2loopback]  /dev/video10  ("Phone Camera")  → Chrome/Zoom/OBS/…
```

- **HTTPS é obrigatório**: navegador só libera `getUserMedia` fora de `localhost` em
  contexto seguro. Cert autoassinado em `cert.pem`/`key.pem` (aceitar o aviso no celular).
- O `ffmpeg` é iniciado **por conexão WebSocket** (em `ws_handler`) e morto no disconnect.
- Cada frame é um JPEG completo concatenado; `ffmpeg -f mjpeg` lê o stream do `pipe:0`.
- O `index.html` é servido com `Cache-Control: no-store` → o celular sempre pega a versão
  nova (sem isso, edições no HTML não chegavam por causa do cache do navegador).
- O preview na tela do celular **é o próprio canvas** (mostra exatamente o que vai pro PC);
  a câmera abre num `<video>` oculto que é a fonte do desenho.

## Arquivos

| Arquivo          | Papel |
|------------------|-------|
| `run.sh`      | **Launcher** principal: `start`/`stop`/`status`/`restart`. Cria venv/cert se faltar, valida device/exclusive_caps, garante instância única. Use isto pra rodar. |
| `server.py`      | Servidor aiohttp HTTPS + WebSocket; faz spawn do ffmpeg que alimenta `/dev/video10`. |
| `index.html`     | Página do celular: preview ao vivo + controles em tempo real (zoom slider/pinça, arrastar, espelhar, girar, enquadrar, reset), seleção de câmera (botões Traseira/Frontal + dropdown de lentes); envia JPEG por WebSocket. |
| `view.js`        | Lógica pura de view-state (zoom/pan/rotação/enquadramento) importada pelo `index.html` como ES module e testada no Node. |
| `pyproject.toml` | Dependências do projeto (`aiohttp` + grupo `dev`), travadas em `uv.lock` e exportadas para `requirements.txt`/`requirements-dev.txt`. |
| `uv.lock`        | Lock do uv (fonte da verdade das versões). Os dois `requirements*.txt` são export dele, não se editam à mão. |
| `run-tests.sh`   | Runner único da suíte: backend (pytest) + frontend (node:test) + launcher (bash), com placar no fim. |
| `tests/`         | `backend/` (pytest, ffmpeg mockado), `frontend/` (node:test do `view.js`), `launcher/` (bash com stubs), `e2e/` (Playwright, opt-in). |
| `reload-cam.sh`  | (sudo) Recarrega o `v4l2loopback` com `exclusive_caps=1` e grava config permanente. |
| `setup.sh`       | Instalação inicial (apt + cert + modprobe). Em geral já não é necessário. |
| `.venv/`         | venv com `aiohttp` (Python é PEP 668 / externally-managed; **não** use pip global). |
| `cert.pem`/`key.pem` | Cert TLS autoassinado. |

## Estado atual (já configurado, NÃO precisa refazer)

- ✅ `v4l2loopback` carregado com `exclusive_caps=1` (confirmado: `Y,N,N,...`).
- ✅ **Permanente**: `/etc/modprobe.d/v4l2loopback.conf` e `/etc/modules-load.d/v4l2loopback.conf`
  criados → o módulo sobe sozinho no boot com os parâmetros certos. NÃO precisa rodar
  `reload-cam.sh` de novo, exceto se a config sumir.
- ✅ `.venv` com aiohttp instalado.
- ✅ Cert TLS gerado.
- ✅ Funcionando ponta a ponta (imagem do celular validada via `ffplay /dev/video10`).
- ⚠️ **Servidor fica DESLIGADO** por padrão — precisa subir manualmente quando for usar.

## Dependências

`pyproject.toml` declara, `uv.lock` trava, os `requirements*.txt` são **export do lock**
(gerados, não edite à mão). O `run.sh` e o `setup.sh` já criam o venv a partir do
`requirements.txt`; para trabalhar nos testes, acrescente o grupo dev:

```bash
uv sync --all-groups                          # com uv: alinha o .venv ao lock
.venv/bin/pip install -r requirements-dev.txt  # sem uv (nunca pip global, PEP 668)
```

Depois de mexer no `pyproject.toml`, re-trave e re-exporte:

```bash
uv lock
uv export --frozen --no-dev      --no-emit-project --no-hashes -o requirements.txt
uv export --frozen --all-groups  --no-emit-project --no-hashes -o requirements-dev.txt
```

## Testes

```bash
./run-tests.sh                      # backend + frontend + launcher (~1s), com placar
RUN_DEVICE_TESTS=1 ./run-tests.sh   # + checagem do /dev/video10 real (opt-in)

npm i -D playwright && npx playwright install chromium   # 1x, para o E2E
RUN_E2E=1 ./run-tests.sh            # + E2E Playwright (opt-in)
```

Por camada:

```bash
.venv/bin/python -m pytest tests/backend -q   # ffmpeg mockado, porta efêmera, sem TLS
node --test 'tests/frontend/*.test.mjs'       # view.js puro, sem DOM
bash tests/launcher/test_launcher.sh          # run.sh com stubs, sem sudo/sem device
```

O caminho padrão não sobe nada na 9443, não dispara o ffmpeg real e não encosta no
`/dev/video10`. O E2E sobe o `server.py` **real** via `tests/e2e/serve_mock.py`, trocando
só o ffmpeg por um `cat` que descarta os frames.

## Como rodar

Forma recomendada (launcher):
```bash
./run.sh            # inicia (foreground, Ctrl+C para parar) e imprime o link
./run.sh status     # mostra estado do servidor + webcam virtual
./run.sh stop       # para
./run.sh restart    # reinicia
```

Direto (equivalente):
```bash
.venv/bin/python server.py
```

## Uso (ordem importa!)

1. Subir o servidor no PC (`./run.sh`).
2. **Celular** (mesma Wi-Fi): abrir `https://192.168.0.{xxx}:9443`, aceitar o cert.
   Escolher a câmera (**📷 Traseira** / **🤳 Frontal** ou o dropdown) — o preview aparece
   mesmo sem transmitir; ajustar zoom/posição; então **Iniciar transmissão** (status 🟢).
   Use o celular **deitado (paisagem)** para casar com o 16:9 da webcam.
3. **PC**: o app de destino só detecta câmeras ao abrir → feche e reabra (`pkill chrome`)
   **com o feed já ativo**, e escolha **"Phone Camera"** (use Chrome .deb, não snap).


## Parâmetros ajustáveis

- **Porta**: padrão **9443**. Override: `PORT=xxxx ./run.sh`.
- **Resolução/FPS/device**: env vars em `server.py` — `CAM_DEVICE`, `CAM_WIDTH`,
  `CAM_HEIGHT`, `CAM_FPS`, `PORT`. Ex.: `CAM_WIDTH=720 CAM_HEIGHT=1280 ./run.sh`
  para uma webcam **vertical** (casa com celular em pé) — mas aí ajuste
  `CANVAS_WIDTH`/`CANVAS_HEIGHT` no `index.html` também.
- **Qualidade JPEG / FPS / resolução de captura**: constantes no topo do `<script>` em
  `index.html` (`CANVAS_WIDTH`, `CANVAS_HEIGHT`, `FPS`, `JPEG_QUALITY`).
- **Enquadramento / transformações**: estado `view` e funções puras em `view.js`
  (`computeDrawParams`, `setZoom`, `panBy`, `cycleRotation`, `toggleFit`, `toggleMirror`),
  aplicadas pelo `drawFrame()` do `index.html`.


## Limitações

- **Uso em rede confiável.** O `/ws` não pede autenticação: qualquer um na mesma LAN que
  abra `wss://<ip>:9443/ws` alimenta a sua webcam virtual. Não exponha a porta para fora.
- **Um celular por vez.** Cada conexão WebSocket sobe o seu próprio ffmpeg no mesmo
  `/dev/video10`; duas ao mesmo tempo disputam o device.
- **Só vídeo**, sem áudio (`audio: false` no `getUserMedia`).

## Notas
- HTTPS é obrigatório: navegadores só liberam câmera fora do `localhost` em conexões seguras.
- Use **Google Chrome (.deb)**. Apps *snap* (Firefox snap, app "Câmera" do Ubuntu) não
  enxergam a câmera virtual ("could not play camera stream") — limitação do confinamento.
- A webcam virtual já está configurada como **permanente** (sobe no boot). Se sumir:
  `sudo bash reload-cam.sh`.
- Variáveis: `CAM_DEVICE`, `CAM_WIDTH`, `CAM_HEIGHT`, `CAM_FPS`, `PORT`.
- Teste a webcam direto: `ffplay /dev/video10`
