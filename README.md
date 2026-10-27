<div align="center">

# CellCam

**A câmera do celular vira webcam do PC (`/dev/video10`, "Phone Camera"), pela rede local.**

![Python](https://img.shields.io/badge/Python-3.12-3670A0?style=for-the-badge&logo=python&logoColor=ffdd54)
![aiohttp](https://img.shields.io/badge/aiohttp-2C5BB4?style=for-the-badge&logo=aiohttp&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)
![FFmpeg](https://img.shields.io/badge/FFmpeg-007808?style=for-the-badge&logo=ffmpeg&logoColor=white)
![v4l2loopback](https://img.shields.io/badge/v4l2loopback-FCC624?style=for-the-badge&logo=linux&logoColor=black)
![Ubuntu](https://img.shields.io/badge/Ubuntu-24.04-E95420?style=for-the-badge&logo=ubuntu&logoColor=white)
![pytest](https://img.shields.io/badge/pytest-0A9EDC?style=for-the-badge&logo=pytest&logoColor=white)
![Playwright](https://img.shields.io/badge/Playwright-2EAD33?style=for-the-badge&logo=playwright&logoColor=white)
![LAN](https://img.shields.io/badge/só%20rede%20local-sem%20nuvem-555555?style=for-the-badge)

</div>

## Sobre o projeto

Transforma a câmera do **celular** numa **webcam virtual no PC** (Ubuntu). O celular
abre uma página web servida pelo PC, captura a câmera e envia os frames; no PC eles
viram um dispositivo `/dev/video10` que apps (Chrome, Zoom, OBS, Meet…) enxergam como
a câmera **"Phone Camera"**.

Montado e testado em Ubuntu (kernel 6.17).

## Configurar num PC novo

1. Instalar (pede sudo: pacotes `v4l2loopback-dkms`, `ffmpeg`, `python3-venv`…, venv e
   certificado HTTPS):
   ```bash
   git clone <url-do-repo> devkit-phone-wi-fi-webcam
   cd devkit-phone-wi-fi-webcam
   ./setup.sh
   ```
2. Deixar a webcam virtual permanente (sobe no boot com `exclusive_caps=1`, que o Chrome exige):
   ```bash
   sudo bash reload-cam.sh
   ```
   Com Secure Boot ligado, o `v4l2loopback-dkms` pede para registrar uma chave (MOK) na
   instalação; aceite e confirme no próximo boot, senão o módulo não carrega.
3. Opcional, recomendado: deixar o `run.sh` recarregar o módulo sem senha a cada subida
   (evita o erro `VIDIOC_G_FMT` na 2ª abertura). Os 3 comandos estão no topo do `reload-mod.sh`
   e o `run.sh` repete eles quando não acha a configuração.
4. Conferir e usar:
   ```bash
   ./run.sh status     # servidor + /dev/video10 + exclusive_caps
   ./run.sh            # sobe e mostra o endereço pro celular
   ```
   Use o Chrome `.deb` (o snap não enxerga `/dev/video10`).

**Fora do repositório:** `cert.pem`/`key.pem` (gerados, ignorados pelo git), `.venv/`,
`/etc/modprobe.d/v4l2loopback.conf` e `/etc/modules-load.d/v4l2loopback.conf`.

## Scripts disponíveis

```bash
# Rodar
./run.sh            # sobe e mostra o endereço (Ctrl+C para)
./run.sh status     # servidor + webcam virtual
./run.sh stop
./run.sh restart

# Testar
./run-tests.sh                      # backend + frontend + launcher (~1 s)
RUN_DEVICE_TESTS=1 ./run-tests.sh   # + /dev/video10 real
RUN_E2E=1 ./run-tests.sh            # + E2E Playwright (npm i -D playwright && npx playwright install chromium)

# Dependências (uv)
uv sync --all-groups
uv lock && uv export --frozen --no-dev --no-emit-project --no-hashes -o requirements.txt
```

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

## Testes por camada

```bash
.venv/bin/python -m pytest tests/backend -q   # ffmpeg mockado, porta efêmera, sem TLS
node --test 'tests/frontend/*.test.mjs'       # view.js puro, sem DOM
bash tests/launcher/test_launcher.sh          # run.sh com stubs, sem sudo/sem device
```

O caminho padrão não sobe nada na 9443, não dispara o ffmpeg real e não encosta no
`/dev/video10`. O E2E sobe o `server.py` **real** via `tests/e2e/serve_mock.py`, trocando
só o ffmpeg por um `cat` que descarta os frames.

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
