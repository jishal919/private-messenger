"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  AlertCircle,
  Camera,
  CameraOff,
  RotateCcw,
  Square,
  SwitchCamera,
  Upload,
  Video,
  X,
} from "lucide-react";

export interface CameraCaptureModalProps {
  onCapture: (file: File) => void;
  onClose: () => void;
  onFallbackToFilePicker?: () => void;
  onError?: (err: string) => void;
}

function formatTimer(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, "0")}:${secs
    .toString()
    .padStart(2, "0")}`;
}

export default function CameraCaptureModal({
  onCapture,
  onClose,
  onFallbackToFilePicker,
  onError,
}: CameraCaptureModalProps) {
  const [mode, setMode] = useState<"photo" | "video">("photo");
  const [facingMode, setFacingMode] = useState<"user" | "environment">(() => {
    if (typeof window !== "undefined") {
      const isMobile =
        window.matchMedia("(max-width: 767px)").matches ||
        navigator.maxTouchPoints > 0 ||
        /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
      return isMobile ? "environment" : "user";
    }
    return "user";
  });
  const [isReady, setIsReady] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false);
  const [errorType, setErrorType] = useState<
    "permission" | "not_found" | "generic" | null
  >(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isMobile =
    typeof window !== "undefined" &&
    (window.matchMedia("(max-width: 767px)").matches ||
      navigator.maxTouchPoints > 0 ||
      /Android|iPhone|iPad|iPod/i.test(navigator.userAgent));

  const canSwitchCamera = hasMultipleCameras || isMobile;

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isStoppingRef = useRef<boolean>(false);

  const stopTracks = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // ignore
        }
      });
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const stopRecordingTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startCamera = useCallback(
    async (facing: "user" | "environment") => {
      stopTracks();
      setIsReady(false);
      setErrorType(null);
      setErrorMessage(null);

      if (
        typeof navigator === "undefined" ||
        !navigator.mediaDevices ||
        !navigator.mediaDevices.getUserMedia
      ) {
        setErrorType("generic");
        setErrorMessage("Camera access is not supported by your browser.");
        return;
      }

      const videoConstraints: MediaTrackConstraints = {
        facingMode: { ideal: facing },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      };

      let stream: MediaStream | null = null;

      try {
        // Try getting video with audio (needed for video recording)
        stream = await navigator.mediaDevices.getUserMedia({
          video: videoConstraints,
          audio: true,
        });
      } catch (firstErr: unknown) {
        const errName = (firstErr as { name?: string })?.name;
        if (
          errName === "NotAllowedError" ||
          errName === "PermissionDeniedError"
        ) {
          setErrorType("permission");
          setErrorMessage(
            "Camera or microphone access was denied. Please allow permissions in your browser settings to continue."
          );
          return;
        }

        // If audio device fails or not available, fallback to video-only
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: videoConstraints,
            audio: false,
          });
        } catch (secondErr: unknown) {
          try {
            // If facing constraint fails, try basic video
            stream = await navigator.mediaDevices.getUserMedia({
              video: true,
              audio: false,
            });
          } catch (thirdErr: unknown) {
            const secondErrName =
              (thirdErr as { name?: string })?.name ||
              (secondErr as { name?: string })?.name;
            if (
              secondErrName === "NotAllowedError" ||
              secondErrName === "PermissionDeniedError"
            ) {
              setErrorType("permission");
              setErrorMessage(
                "Camera access was denied. Please allow camera permissions in your browser settings to continue."
              );
            } else if (
              secondErrName === "NotFoundError" ||
              secondErrName === "DevicesNotFoundError"
            ) {
              setErrorType("not_found");
              setErrorMessage("No camera was found on your device.");
            } else {
              setErrorType("generic");
              setErrorMessage(
                "Unable to start camera. Please verify device permissions and try again."
              );
            }
            return;
          }
        }
      }

      if (!stream) return;

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => {
          videoRef.current?.play().catch(() => {});
          setIsReady(true);
        };
      }

      // Check if multiple camera devices exist
      try {
        if (navigator.mediaDevices.enumerateDevices) {
          const devices = await navigator.mediaDevices.enumerateDevices();
          const videoDevices = devices.filter((d) => d.kind === "videoinput");
          setHasMultipleCameras(videoDevices.length > 1);
        }
      } catch {
        // ignore device enumeration errors
      }
    },
    [stopTracks]
  );

  useEffect(() => {
    startCamera(facingMode);

    return () => {
      stopRecordingTimer();
      stopTracks();
    };
  }, [facingMode, startCamera, stopRecordingTimer, stopTracks]);

  // Handle ESC key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (isRecording) {
          // Cancel recording without saving
          stopRecordingTimer();
          if (
            mediaRecorderRef.current &&
            mediaRecorderRef.current.state !== "inactive"
          ) {
            isStoppingRef.current = true;
            mediaRecorderRef.current.stop();
          }
        }
        stopTracks();
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isRecording, onClose, stopRecordingTimer, stopTracks]);

  const handleFlipCamera = () => {
    if (isRecording) return;
    const nextFacing = facingMode === "user" ? "environment" : "user";
    setFacingMode(nextFacing);
  };

  const handleTakePhoto = () => {
    const video = videoRef.current;
    if (!video || !isReady || video.videoWidth === 0) return;

    try {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // If front camera, mirror photo to match viewfinder preview
      if (facingMode === "user") {
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
      }

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            onError?.("Failed to capture photo from camera.");
            return;
          }

          const file = new File(
            [blob],
            `camera-photo-${Date.now()}.jpg`,
            { type: "image/jpeg" }
          );

          stopTracks();
          onCapture(file);
        },
        "image/jpeg",
        0.95
      );
    } catch (err) {
      console.error("Failed to take photo:", err);
      onError?.("Failed to capture photo from camera.");
    }
  };

  const handleStartRecording = () => {
    const stream = streamRef.current;
    if (!stream || !isReady) return;

    recordedChunksRef.current = [];
    isStoppingRef.current = false;

    // Pick best supported MIME type
    const candidateTypes = [
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm",
      "video/mp4",
    ];

    let selectedType = "";
    for (const t of candidateTypes) {
      if (
        typeof MediaRecorder !== "undefined" &&
        MediaRecorder.isTypeSupported(t)
      ) {
        selectedType = t;
        break;
      }
    }

    try {
      const recorder = selectedType
        ? new MediaRecorder(stream, { mimeType: selectedType })
        : new MediaRecorder(stream);

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          recordedChunksRef.current.push(e.data);
        }
      };

      recorder.onstop = () => {
        stopRecordingTimer();
        setIsRecording(false);

        if (isStoppingRef.current) {
          // Cancelled
          return;
        }

        const chunks = recordedChunksRef.current;
        if (chunks.length === 0) return;

        const finalMime = recorder.mimeType || selectedType || "video/webm";
        const extension = finalMime.includes("mp4") ? "mp4" : "webm";
        const blob = new Blob(chunks, { type: finalMime });

        const file = new File(
          [blob],
          `camera-video-${Date.now()}.${extension}`,
          { type: finalMime }
        );

        stopTracks();
        onCapture(file);
      };

      recorder.start(1000);
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      setRecordingSeconds(0);

      timerRef.current = setInterval(() => {
        setRecordingSeconds((prev) => {
          if (prev >= 300) {
            // Auto stop at 5 minutes
            handleStopRecording();
            return prev;
          }
          return prev + 1;
        });
      }, 1000);
    } catch (err) {
      console.error("Failed to start video recording:", err);
      onError?.("Could not start video recording.");
    }
  };

  const handleStopRecording = () => {
    stopRecordingTimer();
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state !== "inactive"
    ) {
      mediaRecorderRef.current.stop();
    }
  };

  const handleCancelAndClose = () => {
    if (isRecording) {
      isStoppingRef.current = true;
      stopRecordingTimer();
      if (
        mediaRecorderRef.current &&
        mediaRecorderRef.current.state !== "inactive"
      ) {
        mediaRecorderRef.current.stop();
      }
    }
    stopTracks();
    onClose();
  };

  return (
    <div
      className="camera-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Camera capture"
      onClick={handleCancelAndClose}
    >
      <div
        className="camera-modal"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Header */}
        <div className="camera-modal-header">
          <div className="camera-mode-toggle">
            <button
              type="button"
              className={`camera-mode-btn ${mode === "photo" ? "active" : ""}`}
              onClick={() => {
                if (isRecording) return;
                setMode("photo");
              }}
              disabled={isRecording}
              aria-label="Photo mode"
            >
              <Camera size={16} strokeWidth={2} />
              <span>Photo</span>
            </button>
            <button
              type="button"
              className={`camera-mode-btn ${mode === "video" ? "active" : ""}`}
              onClick={() => {
                if (isRecording) return;
                setMode("video");
              }}
              disabled={isRecording}
              aria-label="Video mode"
            >
              <Video size={16} strokeWidth={2} />
              <span>Video</span>
            </button>
          </div>

          <div className="camera-header-actions">
            {canSwitchCamera && !isRecording && (
              <button
                type="button"
                className="camera-action-icon-btn"
                onClick={handleFlipCamera}
                title="Switch camera"
                aria-label="Switch camera"
              >
                <SwitchCamera size={19} strokeWidth={2} />
              </button>
            )}
            <button
              type="button"
              className="camera-action-icon-btn"
              onClick={handleCancelAndClose}
              title="Close camera"
              aria-label="Close camera"
            >
              <X size={20} strokeWidth={2} />
            </button>
          </div>
        </div>

        {/* Viewfinder / Error area */}
        <div className="camera-viewfinder-container">
          {errorType ? (
            <div className="camera-error-view">
              <div className="camera-error-icon-wrap">
                {errorType === "permission" ? (
                  <AlertCircle size={44} className="camera-error-icon" />
                ) : (
                  <CameraOff size={44} className="camera-error-icon" />
                )}
              </div>
              <h3 className="camera-error-title">
                {errorType === "permission"
                  ? "Camera Access Denied"
                  : errorType === "not_found"
                  ? "No Camera Detected"
                  : "Camera Unavailable"}
              </h3>
              <p className="camera-error-desc">{errorMessage}</p>

              <div className="camera-error-actions">
                {onFallbackToFilePicker && (
                  <button
                    type="button"
                    className="camera-fallback-btn"
                    onClick={() => {
                      stopTracks();
                      onClose();
                      onFallbackToFilePicker();
                    }}
                  >
                    <Upload size={16} strokeWidth={2} />
                    <span>Upload from device</span>
                  </button>
                )}
                <button
                  type="button"
                  className="camera-retry-btn"
                  onClick={() => startCamera(facingMode)}
                >
                  <RotateCcw size={16} strokeWidth={2} />
                  <span>Try again</span>
                </button>
              </div>
            </div>
          ) : (
            <>
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className={`camera-viewfinder ${
                  facingMode === "user" ? "camera-viewfinder-mirrored" : ""
                }`}
              />

              {!isReady && (
                <div className="camera-loading-overlay">
                  <div className="camera-loading-spinner" />
                  <span>Starting camera...</span>
                </div>
              )}

              {isRecording && (
                <div className="camera-recording-indicator">
                  <span className="camera-rec-dot" />
                  <span className="camera-rec-timer">
                    {formatTimer(recordingSeconds)} / 05:00
                  </span>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer controls */}
        {!errorType && (
          <div className="camera-modal-footer">
            <div className="camera-footer-side">
              {canSwitchCamera && (
                <button
                  type="button"
                  className="camera-secondary-btn"
                  onClick={handleFlipCamera}
                  disabled={isRecording}
                  title="Switch camera"
                  aria-label="Switch camera"
                >
                  <SwitchCamera size={22} strokeWidth={2} />
                </button>
              )}
            </div>

            <div className="camera-footer-center">
              {mode === "photo" ? (
                <button
                  type="button"
                  className="camera-shutter-btn"
                  onClick={handleTakePhoto}
                  disabled={!isReady}
                  title="Take photo"
                  aria-label="Take photo"
                >
                  <span className="camera-shutter-inner" />
                </button>
              ) : isRecording ? (
                <button
                  type="button"
                  className="camera-record-btn recording"
                  onClick={handleStopRecording}
                  title="Stop recording"
                  aria-label="Stop recording"
                >
                  <Square size={22} className="camera-record-stop-icon" fill="currentColor" />
                </button>
              ) : (
                <button
                  type="button"
                  className="camera-record-btn"
                  onClick={handleStartRecording}
                  disabled={!isReady}
                  title="Start recording"
                  aria-label="Start recording"
                >
                  <span className="camera-record-inner" />
                </button>
              )}
            </div>

            <div className="camera-footer-side">
              {onFallbackToFilePicker && !isRecording && (
                <button
                  type="button"
                  className="camera-secondary-btn"
                  onClick={() => {
                    stopTracks();
                    onClose();
                    onFallbackToFilePicker();
                  }}
                  title="Choose from files"
                  aria-label="Choose from files"
                >
                  <Upload size={20} strokeWidth={2} />
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
