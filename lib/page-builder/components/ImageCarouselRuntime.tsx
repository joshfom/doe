"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface ImageCarouselRuntimeProps {
  images: string[];
  autoplay: boolean;
  interval: number;
  showDots: boolean;
  showArrows: boolean;
  height: string;
  objectFit: string;
  overlayColor: string;
  overlayOpacity: number;
  transition: string;
}

export function ImageCarouselRuntime({
  images,
  autoplay,
  interval,
  showDots,
  showArrows,
  height,
  objectFit,
  overlayColor,
  overlayOpacity,
  transition,
}: ImageCarouselRuntimeProps) {
  const [current, setCurrent] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const count = images.length;

  const goTo = useCallback((idx: number) => {
    setCurrent(((idx % count) + count) % count);
  }, [count]);

  const next = useCallback(() => goTo(current + 1), [current, goTo]);
  const prev = useCallback(() => goTo(current - 1), [current, goTo]);

  // Autoplay
  useEffect(() => {
    if (!autoplay || count <= 1) return;
    timerRef.current = setInterval(next, interval);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [autoplay, interval, count, next]);

  // Pause on hover
  const pauseAutoplay = () => {
    if (timerRef.current) clearInterval(timerRef.current);
  };
  const resumeAutoplay = () => {
    if (!autoplay || count <= 1) return;
    timerRef.current = setInterval(next, interval);
  };

  if (count === 0) {
    return (
      <div
        style={{ height, display: "flex", alignItems: "center", justifyContent: "center", background: "#F2EDE3", color: "#6B6B6B", fontSize: 14 }}
      >
        Add images to the carousel
      </div>
    );
  }

  return (
    <div
      style={{ position: "relative", width: "100%", height, overflow: "hidden" }}
      onMouseEnter={pauseAutoplay}
      onMouseLeave={resumeAutoplay}
    >
      {/* Slides */}
      {images.map((src, i) => {
        const isActive = i === current;
        const slideStyle: React.CSSProperties =
          transition === "slide"
            ? {
                position: "absolute",
                inset: 0,
                transform: `translateX(${(i - current) * 100}%)`,
                transition: "transform 0.6s ease-in-out",
              }
            : {
                position: "absolute",
                inset: 0,
                opacity: isActive ? 1 : 0,
                transition: "opacity 0.8s ease-in-out",
              };

        return (
          <div key={i} style={slideStyle} aria-hidden={!isActive}>
            <img
              src={src}
              alt={`Slide ${i + 1}`}
              style={{
                width: "100%",
                height: "100%",
                objectFit: objectFit as "cover" | "contain",
                display: "block",
              }}
            />
          </div>
        );
      })}

      {/* Overlay */}
      {overlayOpacity > 0 && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundColor: overlayColor,
            opacity: overlayOpacity,
            pointerEvents: "none",
          }}
        />
      )}

      {/* Arrows */}
      {showArrows && count > 1 && (
        <>
          <button
            type="button"
            onClick={prev}
            aria-label="Previous slide"
            style={{
              position: "absolute",
              left: 16,
              top: "50%",
              transform: "translateY(-50%)",
              zIndex: 10,
              width: 40,
              height: 40,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(255,255,255,0.15)",
              backdropFilter: "blur(4px)",
              border: "1px solid rgba(255,255,255,0.3)",
              color: "#fff",
              cursor: "pointer",
              transition: "background 0.2s",
            }}
          >
            <ChevronLeft size={20} strokeWidth={1.5} />
          </button>
          <button
            type="button"
            onClick={next}
            aria-label="Next slide"
            style={{
              position: "absolute",
              right: 16,
              top: "50%",
              transform: "translateY(-50%)",
              zIndex: 10,
              width: 40,
              height: 40,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(255,255,255,0.15)",
              backdropFilter: "blur(4px)",
              border: "1px solid rgba(255,255,255,0.3)",
              color: "#fff",
              cursor: "pointer",
              transition: "background 0.2s",
            }}
          >
            <ChevronRight size={20} strokeWidth={1.5} />
          </button>
        </>
      )}

      {/* Dots */}
      {showDots && count > 1 && (
        <div
          style={{
            position: "absolute",
            bottom: 20,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 10,
            display: "flex",
            gap: 8,
          }}
        >
          {images.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => goTo(i)}
              aria-label={`Go to slide ${i + 1}`}
              style={{
                width: i === current ? 24 : 8,
                height: 8,
                borderRadius: 4,
                border: "none",
                background: i === current ? "#fff" : "rgba(255,255,255,0.5)",
                cursor: "pointer",
                transition: "all 0.3s ease",
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
