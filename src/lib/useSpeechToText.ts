import { useCallback, useEffect, useRef, useState } from "react";

type SpeechRecognitionAlternativeLike = {
  transcript: string;
};

type SpeechRecognitionResultLike = {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
};

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
};

type SpeechRecognitionErrorEventLike = {
  error?: string;
};

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

type UseSpeechToTextArgs = {
  onTranscript: (text: string) => void;
  lang?: string;
};

type UseSpeechToTextResult = {
  isSupported: boolean;
  isStarting: boolean;
  isListening: boolean;
  error: string | null;
  startListening: () => void;
  stopListening: () => void;
};

function getSpeechErrorMessage(errorCode: string | undefined): string | null {
  switch (errorCode) {
    case "aborted":
      return null;
    case "not-allowed":
    case "service-not-allowed":
      return "Microphone access is blocked. Allow mic permissions and try again.";
    case "audio-capture":
      return "No microphone detected.";
    case "network":
      return "Speech recognition network error. Please retry.";
    case "language-not-supported":
      return "Speech language is not supported.";
    case "no-speech":
      return "No speech detected.";
    default:
      return "Voice input stopped due to an error.";
  }
}

export function useSpeechToText({ onTranscript, lang = "en-US" }: UseSpeechToTextArgs): UseSpeechToTextResult {
  const onTranscriptRef = useRef(onTranscript);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSupported = typeof window !== "undefined" && !!(window.SpeechRecognition || window.webkitSpeechRecognition);

  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);

  useEffect(() => {
    if (!isSupported) return;

    const SpeechRecognitionImpl = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!SpeechRecognitionImpl) return;

    const recognition = new SpeechRecognitionImpl();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = lang;

    recognition.onstart = () => {
      setIsStarting(false);
      setIsListening(true);
      setError(null);
    };

    recognition.onresult = (event) => {
      let transcript = "";

      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (!result?.isFinal) continue;

        for (let j = 0; j < result.length; j += 1) {
          transcript += result[j]?.transcript ?? "";
        }
      }

      const normalizedTranscript = transcript.trim();
      if (normalizedTranscript) {
        onTranscriptRef.current(normalizedTranscript);
      }
    };

    recognition.onerror = (event) => {
      setIsStarting(false);
      setIsListening(false);
      setError(getSpeechErrorMessage(event.error));
    };

    recognition.onend = () => {
      setIsStarting(false);
      setIsListening(false);
    };

    recognitionRef.current = recognition;

    return () => {
      recognition.onstart = null;
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognition.abort();
      recognitionRef.current = null;
    };
  }, [isSupported, lang]);

  const startListening = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!recognition || isStarting || isListening) return;

    try {
      setError(null);
      setIsStarting(true);
      recognition.start();
    } catch {
      setIsStarting(false);
      setIsListening(false);
      setError("Could not start microphone.");
    }
  }, [isListening, isStarting]);

  const stopListening = useCallback(() => {
    const recognition = recognitionRef.current;
    if (recognition) {
      try {
        recognition.stop();
      } catch {
        // Ignore stop races (for example when recognition already ended).
      }
    }
    setIsStarting(false);
    setIsListening(false);
  }, []);

  return {
    isSupported,
    isStarting,
    isListening,
    error,
    startListening,
    stopListening,
  };
}
