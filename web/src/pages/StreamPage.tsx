import {
  Camera,
  FlipHorizontal2,
  RotateCcw,
  RotateCw,
  SlidersHorizontal,
  SwitchCamera,
  Users,
  Webcam,
  ZoomIn,
} from 'lucide-react';
import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { NetworkPanel } from '@/components/NetworkPanel';
import { QualityControls } from '@/components/QualityControls';
import { RequestList } from '@/components/RequestList';
import { RetroWindow } from '@/components/RetroWindow';
import { CameraStreamer, type CameraOption } from '@/lib/cameraStreamer';
import { GestureTracker, type ScreenPoint } from '@/lib/gestures';
import { t, useLanguage } from '@/lib/i18n';
import { loadQuality, saveQuality, type QualitySettings } from '@/lib/quality';
import { useSession, useSessionStore } from '@/lib/SessionContext';
import { fitButtonLabel, zoomLabel, type StatusMessage } from '@/lib/streamText';
import {
  cycleRotation,
  panBy,
  resetView,
  setRotation,
  setZoom,
  toggleFit,
  toggleMirror,
  ZOOM_MAX,
  ZOOM_MIN,
  type ViewState,
} from '@/lib/view';

const ZOOM_STEP = 0.01;
const BACK_CAMERA: MediaTrackConstraints = { facingMode: { exact: 'environment' } };
const FRONT_CAMERA: MediaTrackConstraints = { facingMode: { exact: 'user' } };

interface StreamPageProps {
  hidden: boolean;
}

const pointOf = (event: PointerEvent<HTMLCanvasElement>): ScreenPoint => ({ x: event.clientX, y: event.clientY });

export function StreamPage({ hidden }: Readonly<StreamPageProps>): ReactNode {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamerRef = useRef<CameraStreamer | null>(null);
  const gesturesRef = useRef(new GestureTracker());
  const [view, setView] = useState<ViewState>(resetView);
  // Null until the streamer reports something: the first hint is written at render, in the language of now.
  const [reported, setStatus] = useState<StatusMessage | null>(null);
  const status = reported ?? { text: t('Tap "Start streaming"'), kind: '' };
  const [streaming, setStreaming] = useState(false);
  const [cameras, setCameras] = useState<CameraOption[]>([]);
  const [selectedCamera, setSelectedCamera] = useState('');
  const [quality, setQuality] = useState<QualitySettings>(loadQuality);
  const [frameSize, setFrameSize] = useState<number | null>(null);
  const store = useSessionStore();
  const session = useSession();
  const language = useLanguage();

  useEffect(() => {
    // The status line was written in the old language: write it again in the new one.
    streamerRef.current?.refreshStatus();
  }, [language]);

  useEffect(() => {
    // The canvas is always rendered, so its ref is set by the time the effect runs.
    const canvas = canvasRef.current as HTMLCanvasElement;
    const streamer = new CameraStreamer(
      canvas,
      {
        onStatus: setStatus,
        onStreamingChange: setStreaming,
        onCamerasChange: setCameras,
        onFrameSize: setFrameSize,
      },
      t,
      store,
    );
    streamer.setQuality(loadQuality());
    streamer.listCameras();
    streamerRef.current = streamer;
    const unsubscribe = store.onMessage((message) => streamer.handleServerMessage(message));

    return () => {
      unsubscribe();
      streamer.destroy();
      streamerRef.current = null;
    };
  }, [store]);
  const applyView = (next: ViewState): void => {
    setView(next);
    streamerRef.current?.setView(next);
  };

  const openCamera = (constraint: MediaTrackConstraints): void => {
    void streamerRef.current?.openCamera(constraint);
  };

  const selectLens = (deviceId: string): void => {
    setSelectedCamera(deviceId);
    openCamera({ deviceId: { exact: deviceId } });
  };

  const changeQuality = (next: QualitySettings): void => {
    setQuality(next);
    saveQuality(next);
    // The streamer lives as long as the page, so it is there for any change the page makes.
    setView((streamerRef.current as CameraStreamer).setQuality(next));
  };

  const canvasScale = (canvas: HTMLCanvasElement): number => {
    const displayedWidth = canvas.getBoundingClientRect().width;

    return displayedWidth > 0 ? canvas.width / displayedWidth : 1;
  };

  const onPointerDown = (event: PointerEvent<HTMLCanvasElement>): void => {
    event.currentTarget.setPointerCapture?.(event.pointerId);
    gesturesRef.current.down(event.pointerId, pointOf(event), view.zoom, view.rotation);
  };

  const onPointerMove = (event: PointerEvent<HTMLCanvasElement>): void => {
    const change = gesturesRef.current.move(event.pointerId, pointOf(event), canvasScale(event.currentTarget));
    if (change?.type === 'pan') {
      applyView(panBy(view, change.deltaX, change.deltaY));
    }
    if (change?.type === 'zoom') {
      applyView(setRotation(setZoom(view, change.zoom), change.rotation));
    }
  };

  const onPointerEnd = (event: PointerEvent<HTMLCanvasElement>): void => {
    gesturesRef.current.up(event.pointerId);
  };

  return (
    <section className="page stream" aria-labelledby="stream-title" hidden={hidden}>
      <RetroWindow title={t('Camera → PC webcam')} icon={Webcam} titleId="stream-title" className="preview-window">
        <canvas
          id="preview"
          ref={canvasRef}
          role="img"
          aria-label={t('Camera preview, exactly what the PC gets')}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
        />
        <div id="status" role="status" className={`status ${status.kind}`}>
          {status.text}
        </div>
      </RetroWindow>

      <RetroWindow title={t('Controls')} icon={SlidersHorizontal} tone="teal" className="panel">
        <div className="zoomrow">
          <label htmlFor="zoom">
            <ZoomIn className="icon" aria-hidden="true" />
            {t('Zoom')}
          </label>
          <input
            type="range"
            id="zoom"
            min={ZOOM_MIN}
            max={ZOOM_MAX}
            step={ZOOM_STEP}
            value={view.zoom}
            onChange={(event) => applyView(setZoom(view, Number(event.target.value)))}
          />
          <span className="zoom-value">{zoomLabel(view.zoom)}</span>
        </div>
        <div className="row">
          <button
            type="button"
            id="mirrorBtn"
            aria-pressed={view.mirror}
            className={view.mirror ? 'active' : undefined}
            onClick={() => applyView(toggleMirror(view))}>
            <FlipHorizontal2 className="icon" aria-hidden="true" />
            {t('Mirror')}
          </button>
          <button type="button" id="rotBtn" onClick={() => applyView(cycleRotation(view))}>
            <RotateCw className="icon" aria-hidden="true" />
            {t('Rotate 90°')}
          </button>
          <button type="button" id="fitBtn" onClick={() => applyView(toggleFit(view))}>
            {fitButtonLabel(t, view.fit)}
          </button>
          <button type="button" id="resetBtn" onClick={() => applyView(resetView())}>
            <RotateCcw className="icon" aria-hidden="true" />
            {t('Reset')}
          </button>
        </div>
        <div className="row">
          <button type="button" id="backBtn" onClick={() => openCamera(BACK_CAMERA)}>
            <Camera className="icon" aria-hidden="true" />
            {t('Back')}
          </button>
          <button type="button" id="frontBtn" onClick={() => openCamera(FRONT_CAMERA)}>
            <SwitchCamera className="icon" aria-hidden="true" />
            {t('Front')}
          </button>
        </div>
        <div className="row">
          <select
            id="camSel"
            aria-label={t('Lens')}
            value={selectedCamera}
            onChange={(event) => selectLens(event.target.value)}>
            {cameras.map((camera) => (
              <option key={camera.deviceId} value={camera.deviceId}>
                {camera.label}
              </option>
            ))}
          </select>
        </div>
        <div className="row">
          <button
            type="button"
            id="startBtn"
            className="primary"
            disabled={streaming}
            onClick={() => void streamerRef.current?.start()}>
            {t('Start streaming')}
          </button>
          <button type="button" id="stopBtn" disabled={!streaming} onClick={() => streamerRef.current?.stop()}>
            {t('Stop')}
          </button>
        </div>
        <QualityControls settings={quality} averageFrameBytes={frameSize} onChange={changeQuality} />
      </RetroWindow>

      <div className="side-by-side">
        <section className="who-watches" aria-labelledby="who-watches-title">
          <RetroWindow title={t('Who may watch')} icon={Users} titleId="who-watches-title" level={2} tone="pink">
            {streaming ? (
              <RequestList requests={session.requests} onDecide={(id, decision) => store.decide(id, decision)} />
            ) : (
              <p className="hint">{t('Start streaming to see and approve who asks to watch.')}</p>
            )}
          </RetroWindow>
        </section>
        {!hidden && session.network && <NetworkPanel network={session.network} />}
      </div>
    </section>
  );
}
