import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

type UseChatScrollBehaviorParams = {
  chatId?: string;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  lastUserMessageRef: RefObject<HTMLDivElement | null>;
  messageCount: number;
  userMessageCount: number;
  isStreaming: boolean;
  streamingContentLength: number;
  hasRunningTool: boolean;
  hasPendingApproval: boolean;
  topOffset?: number;
  nearBottomThreshold?: number;
};

type UseChatScrollBehaviorResult = {
  isNearBottom: boolean;
  shouldAutoFollow: boolean;
  requestPinLatestUserMessage: () => void;
};

const DEFAULT_TOP_OFFSET = 16;
const DEFAULT_NEAR_BOTTOM_THRESHOLD = 80;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getMaxScrollTop(container: HTMLDivElement): number {
  return Math.max(0, container.scrollHeight - container.clientHeight);
}

function getDistanceFromBottom(container: HTMLDivElement): number {
  return getMaxScrollTop(container) - container.scrollTop;
}

export function useChatScrollBehavior({
  chatId,
  scrollContainerRef,
  lastUserMessageRef,
  messageCount,
  userMessageCount,
  isStreaming,
  streamingContentLength,
  hasRunningTool,
  hasPendingApproval,
  topOffset = DEFAULT_TOP_OFFSET,
  nearBottomThreshold = DEFAULT_NEAR_BOTTOM_THRESHOLD,
}: UseChatScrollBehaviorParams): UseChatScrollBehaviorResult {
  const [isNearBottom, setIsNearBottom] = useState(true);
  const [shouldAutoFollow, setShouldAutoFollow] = useState(true);

  const shouldAutoFollowRef = useRef(true);
  const programmaticScrollLocksRef = useRef(0);
  const previousScrollTopRef = useRef(0);
  const pendingPinTargetUserCountRef = useRef<number | null>(null);
  const didInitialScrollRef = useRef(false);
  const followFrameRef = useRef<number | null>(null);
  const pinFrameRef = useRef<number | null>(null);

  const setAutoFollow = useCallback((nextValue: boolean) => {
    if (shouldAutoFollowRef.current === nextValue) return;
    shouldAutoFollowRef.current = nextValue;
    setShouldAutoFollow(nextValue);
  }, []);

  const isNearBottomCheck = useCallback(
    (container: HTMLDivElement) => getDistanceFromBottom(container) <= nearBottomThreshold,
    [nearBottomThreshold]
  );

  const syncNearBottomState = useCallback(
    (container: HTMLDivElement) => {
      const nearBottom = isNearBottomCheck(container);
      setIsNearBottom((prev) => (prev === nearBottom ? prev : nearBottom));
      return nearBottom;
    },
    [isNearBottomCheck]
  );

  const withProgrammaticScroll = useCallback((callback: () => void) => {
    programmaticScrollLocksRef.current += 1;
    callback();

    window.requestAnimationFrame(() => {
      programmaticScrollLocksRef.current = Math.max(0, programmaticScrollLocksRef.current - 1);
    });
  }, []);

  const scrollToBottomIfNeeded = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const maxScrollTop = getMaxScrollTop(container);
    if (Math.abs(container.scrollTop - maxScrollTop) <= 1) return;

    withProgrammaticScroll(() => {
      container.scrollTop = maxScrollTop;
      previousScrollTopRef.current = maxScrollTop;
    });

    syncNearBottomState(container);
  }, [scrollContainerRef, syncNearBottomState, withProgrammaticScroll]);

  const scheduleFollowToBottom = useCallback(() => {
    if (followFrameRef.current != null) return;

    followFrameRef.current = window.requestAnimationFrame(() => {
      followFrameRef.current = null;

      const container = scrollContainerRef.current;
      if (!container) return;
      if (!shouldAutoFollowRef.current) return;
      if (!isNearBottomCheck(container)) return;

      scrollToBottomIfNeeded();
    });
  }, [isNearBottomCheck, scrollContainerRef, scrollToBottomIfNeeded]);

  const pinLatestUserMessageToTop = useCallback(() => {
    const container = scrollContainerRef.current;
    const lastUserMessage = lastUserMessageRef.current;
    if (!container || !lastUserMessage) return;

    const targetScrollTop = lastUserMessage.offsetTop - topOffset;
    const nextScrollTop = clamp(targetScrollTop, 0, getMaxScrollTop(container));

    if (Math.abs(container.scrollTop - nextScrollTop) <= 1) {
      syncNearBottomState(container);
      return;
    }

    withProgrammaticScroll(() => {
      container.scrollTop = nextScrollTop;
      previousScrollTopRef.current = nextScrollTop;
    });

    syncNearBottomState(container);
  }, [lastUserMessageRef, scrollContainerRef, syncNearBottomState, topOffset, withProgrammaticScroll]);

  const requestPinLatestUserMessage = useCallback(() => {
    // Pin only once for the next user row added after send.
    pendingPinTargetUserCountRef.current = userMessageCount + 1;
    didInitialScrollRef.current = true;
    setAutoFollow(true);
  }, [setAutoFollow, userMessageCount]);

  useEffect(() => {
    pendingPinTargetUserCountRef.current = null;
    didInitialScrollRef.current = false;
    previousScrollTopRef.current = 0;
    programmaticScrollLocksRef.current = 0;
    shouldAutoFollowRef.current = true;

    if (followFrameRef.current != null) {
      window.cancelAnimationFrame(followFrameRef.current);
      followFrameRef.current = null;
    }

    if (pinFrameRef.current != null) {
      window.cancelAnimationFrame(pinFrameRef.current);
      pinFrameRef.current = null;
    }
  }, [chatId]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    previousScrollTopRef.current = container.scrollTop;

    const onScroll = () => {
      const currentScrollTop = container.scrollTop;
      const nearBottom = syncNearBottomState(container);

      if (programmaticScrollLocksRef.current > 0) {
        previousScrollTopRef.current = currentScrollTop;
        return;
      }

      const scrolledUp = currentScrollTop < previousScrollTopRef.current - 1;

      // As soon as the user scrolls up, stop auto-follow so streaming cannot fight manual scroll.
      if (scrolledUp) {
        setAutoFollow(false);
      } else if (nearBottom) {
        // Re-enable only after the user naturally comes back near the bottom.
        setAutoFollow(true);
      }

      previousScrollTopRef.current = currentScrollTop;
    };

    container.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    return () => {
      container.removeEventListener("scroll", onScroll);
    };
  }, [scrollContainerRef, setAutoFollow, syncNearBottomState]);

  useEffect(() => {
    if (didInitialScrollRef.current) return;
    if (messageCount === 0) return;

    // Initial load anchors at bottom once.
    didInitialScrollRef.current = true;

    const frameId = window.requestAnimationFrame(() => {
      scrollToBottomIfNeeded();
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [messageCount, scrollToBottomIfNeeded]);

  useLayoutEffect(() => {
    const targetUserCount = pendingPinTargetUserCountRef.current;
    if (targetUserCount == null) return;
    if (userMessageCount < targetUserCount) return;

    if (pinFrameRef.current != null) {
      window.cancelAnimationFrame(pinFrameRef.current);
    }

    pinFrameRef.current = window.requestAnimationFrame(() => {
      pinFrameRef.current = null;
      pinLatestUserMessageToTop();
      pendingPinTargetUserCountRef.current = null;
    });

    return () => {
      if (pinFrameRef.current != null) {
        window.cancelAnimationFrame(pinFrameRef.current);
        pinFrameRef.current = null;
      }
    };
  }, [pinLatestUserMessageToTop, userMessageCount]);

  const hasActiveAssistantOutput = isStreaming || streamingContentLength > 0 || hasRunningTool || hasPendingApproval;

  useEffect(() => {
    if (!hasActiveAssistantOutput) return;

    const container = scrollContainerRef.current;
    if (!container) return;
    if (!shouldAutoFollowRef.current) return;
    if (!isNearBottomCheck(container)) return;

    // Stream updates follow only when user remains near the bottom.
    scheduleFollowToBottom();
  }, [
    hasActiveAssistantOutput,
    isNearBottomCheck,
    messageCount,
    scheduleFollowToBottom,
    scrollContainerRef,
    streamingContentLength,
  ]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const onResize = () => {
      const nearBottom = syncNearBottomState(container);

      if (shouldAutoFollowRef.current && nearBottom) {
        scheduleFollowToBottom();
      }
    };

    if (typeof ResizeObserver !== "undefined") {
      const resizeObserver = new ResizeObserver(onResize);
      resizeObserver.observe(container);
      return () => resizeObserver.disconnect();
    }

    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [scheduleFollowToBottom, scrollContainerRef, syncNearBottomState]);

  useEffect(() => {
    return () => {
      if (followFrameRef.current != null) {
        window.cancelAnimationFrame(followFrameRef.current);
      }
      if (pinFrameRef.current != null) {
        window.cancelAnimationFrame(pinFrameRef.current);
      }
    };
  }, []);

  return {
    isNearBottom,
    shouldAutoFollow,
    requestPinLatestUserMessage,
  };
}
