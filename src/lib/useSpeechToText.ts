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
  error: string;
};

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
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
  isListening: boolean;
  startListening: () => void;
  stopListening: () => void;
};

export function useSpeechToText({ onTranscript, lang = "en-US" }: UseSpeechToTextArgs): UseSpeechToTextResult {
  const onTranscriptRef = useRef(onTranscript);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const [isListening, setIsListening] = useState(false);

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
    recognition.interimResults = false;
    recognition.lang = lang;

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

    recognition.onerror = () => {
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognitionRef.current = recognition;

    return () => {
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognition.abort();
      recognitionRef.current = null;
    };
  }, [isSupported, lang]);

  const startListening = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!recognition) return;

    try {
      recognition.start();
      setIsListening(true);
    } catch {
      setIsListening(false);
    }
  }, []);

  const stopListening = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!recognition) return;

    recognition.stop();
    setIsListening(false);
  }, []);

  return {
    isSupported,
    isListening,
    startListening,
    stopListening,
  };
}
