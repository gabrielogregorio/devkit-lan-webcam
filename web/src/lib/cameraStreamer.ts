import type { Translate } from '@/lib/i18n';
import { CAMERA_START, CAMERA_STOP, type ServerMessage } from '@/lib/protocol';
import { DEFAULT_QUALITY, resolutionOf, type QualitySettings } from '@/lib/quality';
import type { SessionTransport } from '@/lib/sessionStore';
import {
  cameraFailureStatus,
  cameraListStatus,
  previewStatus,
  type StatusKind,
  type StatusMessage,
} from '@/lib/streamText';
import { computeDrawParams, resetView, scaleOffsets, type ViewState } from '@/lib/view';

/*
 * Camera -> canvas -> JPEG -> encrypted session. The preview on screen IS the canvas that is sent; the camera
 * plays in a hidden <video> that only feeds it. Needs a real camera, canvas and socket, so it is covered by the
 * E2E (tests/e2e) instead of the unit tests.
 */
const MILLISECONDS_PER_SECOND = 1000;
// One frame in flight at most: a queue of old frames on a slow Wi-Fi is pure delay.
const MAX_BUFFERED_BYTES = 0;
// Android needs a breather between releasing and reopening the sensor, or it throws NotReadableError.
const CAMERA_RELEASE_DELAY_MS = 150;
const DEGREES_TO_RADIANS = Math.PI / 180;
// Frames averaged for the size shown under the quality controls.
const FRAME_SIZE_WINDOW = 25;

export interface CameraOption {
  deviceId: string;
  label: string;
}

export interface StreamerCallbacks {
  onStatus: (status: StatusMessage) => void;
  onStreamingChange: (streaming: boolean) => void;
  onCamerasChange: (cameras: CameraOption[]) => void;
  onFrameSize: (averageBytes: number | null) => void;
}

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

const errorReason = (error: unknown): string => {
  if (error instanceof Error) {
    return error.name || error.message;
  }

  return String(error);
};

export class CameraStreamer {
  private readonly context: CanvasRenderingContext2D | null;
  private readonly video: HTMLVideoElement;
  private mediaStream: MediaStream | null = null;
  private sendTimer: ReturnType<typeof setInterval> | null = null;
  private animationFrameId: number | null = null;
  private streaming = false;
  private encodingFrame = false;
  private openingCamera = false;
  private view: ViewState = resetView();
  private quality: QualitySettings = { ...DEFAULT_QUALITY };
  private readonly frameSizes: number[] = [];
  // Last camera that really opened: where we go back to when a new lens fails.
  private wantedConstraint: MediaTrackConstraints = { facingMode: { ideal: 'environment' } };
  private readonly onDeviceChange = (): void => {
    this.listCameras();
  };

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly callbacks: StreamerCallbacks,
    private readonly t: Translate,
    private readonly transport: SessionTransport,
  ) {
    this.context = canvas.getContext('2d', { alpha: false });
    this.applyCanvasSize();
    this.video = document.createElement('video');
    this.video.playsInline = true;
    this.video.muted = true;
    this.video.setAttribute('playsinline', '');
    // Camera labels only show up after the permission, and that arrives as a devicechange.
    navigator.mediaDevices?.addEventListener?.('devicechange', this.onDeviceChange);
    this.drawFrame();
  }

  setView(view: ViewState): void {
    this.view = view;
    if (this.animationFrameId === null) {
      this.drawFrame();
    }
  }

  // A new size keeps the framing: the pan offsets scale with the canvas.
  setQuality(quality: QualitySettings): ViewState {
    const previousWidth = this.canvas.width;
    this.quality = quality;
    this.applyCanvasSize();
    this.view = scaleOffsets(this.view, this.canvas.width / previousWidth);
    this.frameSizes.length = 0;
    this.callbacks.onFrameSize(null);
    if (this.sendTimer !== null) {
      this.restartSendTimer();
    }
    this.drawFrame();

    return this.view;
  }

  handleServerMessage(message: ServerMessage): void {
    if (message.type === 'camera-stopped' && this.streaming) {
      const reason =
        message.reason === 'taken'
          ? this.t('Another device started streaming.')
          : this.t('The PC webcam stopped taking frames.');
      this.stop(reason, false);
    }
    if (message.type === 'camera-error' && this.streaming) {
      this.stop(this.t('The PC could not start the webcam (ffmpeg).'), false);
    }
  }

  async openCamera(constraint: MediaTrackConstraints = this.wantedConstraint): Promise<void> {
    if (this.openingCamera) {
      return;
    }
    this.openingCamera = true;
    this.setStatus(this.t('Opening camera…'), 'warn');
    try {
      this.stopMediaStream();
      await delay(CAMERA_RELEASE_DELAY_MS);
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: constraint });
        this.wantedConstraint = constraint;
      } catch (error) {
        // An auxiliary lens (ultra-wide/tele) often throws NotReadableError when opened by deviceId.
        const reverted = await this.revertToLastWorkingCamera();
        if (reverted) {
          await this.attachStream(reverted);
        }
        this.callbacks.onStatus(cameraFailureStatus(this.t, errorReason(error), reverted !== null));

        return;
      }
      await this.attachStream(stream);
      await this.refreshCameras();
      this.callbacks.onStatus(previewStatus(this.t, this.activeCameraLabel(), this.streaming));
    } finally {
      this.openingCamera = false;
    }
  }

  async start(): Promise<void> {
    if (this.streaming) {
      return;
    }
    if (!this.mediaStream) {
      await this.openCamera();
    }
    if (!this.mediaStream) {
      this.setStatus(this.t('No camera. Allow access and tap Back/Front'), 'err');

      return;
    }
    if (!this.transport.sendJson(CAMERA_START)) {
      this.setStatus(this.t('Not connected to the PC yet.'), 'err');

      return;
    }
    this.streaming = true;
    this.callbacks.onStreamingChange(true);
    this.callbacks.onStatus(previewStatus(this.t, this.activeCameraLabel(), true));
    this.restartSendTimer();
  }

  stop(reason: string = this.t('Stopped'), tellServer = true): void {
    if (this.streaming && tellServer) {
      this.transport.sendJson(CAMERA_STOP);
    }
    this.streaming = false;
    if (this.sendTimer !== null) {
      clearInterval(this.sendTimer);
      this.sendTimer = null;
    }
    this.stopMediaStream();
    this.video.srcObject = null;
    this.stopRender();
    this.frameSizes.length = 0;
    this.callbacks.onFrameSize(null);
    this.callbacks.onStreamingChange(false);
    this.setStatus(reason, 'warn');
  }

  destroy(): void {
    navigator.mediaDevices?.removeEventListener?.('devicechange', this.onDeviceChange);
    if (this.streaming || this.mediaStream) {
      this.stop();
    }
  }

  // Fills the lens list; called once the page is up and again on every device change.
  listCameras(): void {
    void this.refreshCameras();
  }

  private applyCanvasSize(): void {
    const resolution = resolutionOf(this.quality);
    this.canvas.width = resolution.width;
    this.canvas.height = resolution.height;
  }

  private restartSendTimer(): void {
    if (this.sendTimer !== null) {
      clearInterval(this.sendTimer);
    }
    this.sendTimer = setInterval(() => this.sendFrame(), MILLISECONDS_PER_SECOND / this.quality.fps);
  }

  private setStatus(text: string, kind: StatusKind): void {
    this.callbacks.onStatus({ text, kind });
  }

  private drawFrame(): void {
    const context = this.context;
    if (!context) {
      return;
    }
    const { width, height } = this.canvas;
    context.fillStyle = '#000';
    context.fillRect(0, 0, width, height);
    const { videoWidth, videoHeight } = this.video;
    if (!videoWidth || !videoHeight) {
      return;
    }
    const params = computeDrawParams(this.view, videoWidth, videoHeight, width, height);
    context.save();
    context.translate(params.translateX, params.translateY);
    context.rotate(params.rotation * DEGREES_TO_RADIANS);
    context.scale(params.mirrorX, 1);
    context.drawImage(this.video, -params.drawWidth / 2, -params.drawHeight / 2, params.drawWidth, params.drawHeight);
    context.restore();
  }

  private readonly renderLoop = (): void => {
    this.drawFrame();
    this.animationFrameId = requestAnimationFrame(this.renderLoop);
  };

  private startRender(): void {
    if (this.animationFrameId === null) {
      this.renderLoop();
    }
  }

  private stopRender(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    this.drawFrame();
  }

  private sendFrame(): void {
    if (!this.streaming || !this.transport.isOpen) {
      return;
    }
    // A stalled network must not pile up old frames in the device's memory.
    if (this.transport.bufferedAmount > MAX_BUFFERED_BYTES || this.encodingFrame) {
      return;
    }
    this.encodingFrame = true;
    this.canvas.toBlob(
      (jpegBlob) => {
        if (!jpegBlob || !this.streaming) {
          this.encodingFrame = false;

          return;
        }
        void jpegBlob.arrayBuffer().then((buffer) => {
          this.encodingFrame = false;
          if (this.streaming && this.transport.sendFrame(new Uint8Array(buffer))) {
            this.recordFrameSize(buffer.byteLength);
          }
        });
      },
      'image/jpeg',
      this.quality.jpegQuality,
    );
  }

  private recordFrameSize(bytes: number): void {
    this.frameSizes.push(bytes);
    if (this.frameSizes.length > FRAME_SIZE_WINDOW) {
      this.frameSizes.shift();
    }
    if (this.frameSizes.length === FRAME_SIZE_WINDOW) {
      const total = this.frameSizes.reduce((sum, size) => sum + size, 0);
      this.callbacks.onFrameSize(total / FRAME_SIZE_WINDOW);
      this.frameSizes.length = 0;
    }
  }

  private activeCameraLabel(): string {
    const videoTrack = this.mediaStream?.getVideoTracks()[0];
    if (!videoTrack) {
      return this.t('camera');
    }
    const settings = videoTrack.getSettings();

    return videoTrack.label || settings.facingMode || '?';
  }

  private async refreshCameras(): Promise<void> {
    if (!navigator.mediaDevices?.enumerateDevices) {
      return;
    }
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cameras = devices
        .filter((device) => device.kind === 'videoinput')
        .map((device, index) => ({
          deviceId: device.deviceId,
          label: device.label || this.t('Camera {number}', { number: index + 1 }),
        }));
      this.callbacks.onCamerasChange(cameras);
      this.callbacks.onStatus(cameraListStatus(this.t, cameras.length, this.streaming));
    } catch {
      // Listing is best effort: without permission the list stays empty and the Back/Front buttons still work.
    }
  }

  private stopMediaStream(): void {
    this.mediaStream?.getTracks().forEach((track) => track.stop());
    this.mediaStream = null;
  }

  private async revertToLastWorkingCamera(): Promise<MediaStream | null> {
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: false, video: this.wantedConstraint });
    } catch {
      return null;
    }
  }

  private async attachStream(stream: MediaStream): Promise<void> {
    this.mediaStream = stream;
    this.video.srcObject = stream;
    await this.video.play();
    this.startRender();
  }
}
