"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

export interface GalleryImage {
  src: string;
  alt?: string;
}

export interface GalleryRuntimeProps {
  images: GalleryImage[];
  mode: "grid" | "carousel";
  columns: number;
  gap: number;
  imageHeight: string;
  objectFit: "cover" | "contain";
  borderRadius: number;
  showArrows: boolean;
  enableLightbox: boolean;
  itemsPerView: number;
}

// ─── Lightbox (rendered via portal to escape stacking contexts) ──────────────

function Lightbox({
  images,
  currentIndex,
  onClose,
  onNext,
  onPrev,
}: {
  images: GalleryImage[];
  currentIndex: number;
  onClose: () => void;
  onNext: () => void;
  onPrev: () => void;
}) {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") onNext();
      if (e.key === "ArrowLeft") onPrev();
    };
    document.addEventListener("keydown", handleKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = "";
    };
  }, [onClose, onNext, onPrev]);

  const current = images[currentIndex];

  const overlay = (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2147483647,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0, 0, 0, 0.92)",
      }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Image lightbox"
    >
      {/* Close button */}
      <button
        type="button"
        onClick={onClose}
        aria-label="Close lightbox"
        style={{
          position: "absolute",
          top: 16,
          right: 16,
          zIndex: 2147483647,
          width: 40,
          height: 40,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "rgba(255,255,255,0.1)",
          backdropFilter: "blur(4px)",
          border: "1px solid rgba(255,255,255,0.2)",
          borderRadius: "50%",
          color: "#fff",
          cursor: "pointer",
        }}
      >
        <X size={20} strokeWidth={1.5} />
      </button>

      {/* Previous arrow */}
      {images.length > 1 && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onPrev();
          }}
          aria-label="Previous image"
          style={{
            position: "absolute",
            left: 16,
            top: "50%",
            transform: "translateY(-50%)",
            zIndex: 2147483647,
            width: 44,
            height: 44,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(255,255,255,0.1)",
            backdropFilter: "blur(4px)",
            border: "1px solid rgba(255,255,255,0.2)",
            borderRadius: "50%",
            color: "#fff",
            cursor: "pointer",
          }}
        >
          <ChevronLeft size={22} strokeWidth={1.5} />
        </button>
      )}

      {/* Image */}
      <img
        src={current.src}
        alt={current.alt || `Image ${currentIndex + 1}`}
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: "85vw",
          maxHeight: "85vh",
          objectFit: "contain",
        }}
      />

      {/* Next arrow */}
      {images.length > 1 && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onNext();
          }}
          aria-label="Next image"
          style={{
            position: "absolute",
            right: 16,
            top: "50%",
            transform: "translateY(-50%)",
            zIndex: 2147483647,
            width: 44,
            height: 44,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(255,255,255,0.1)",
            backdropFilter: "blur(4px)",
            border: "1px solid rgba(255,255,255,0.2)",
            borderRadius: "50%",
            color: "#fff",
            cursor: "pointer",
          }}
        >
          <ChevronRight size={22} strokeWidth={1.5} />
        </button>
      )}

      {/* Counter */}
      <div
        style={{
          position: "absolute",
          bottom: 20,
          left: "50%",
          transform: "translateX(-50%)",
          color: "rgba(255,255,255,0.7)",
          fontSize: 14,
        }}
      >
        {currentIndex + 1} / {images.length}
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}

// ─── Grid Mode ───────────────────────────────────────────────────────────────

function GridGallery({
  images,
  columns,
  gap,
  imageHeight,
  objectFit,
  enableLightbox,
  onImageClick,
}: {
  images: GalleryImage[];
  columns: number;
  gap: number;
  imageHeight: string;
  objectFit: "cover" | "contain";
  enableLightbox: boolean;
  onImageClick: (index: number) => void;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${columns}, 1fr)`,
        gap: `${gap}px`,
      }}
    >
      {images.map((img, i) => (
        <div
          key={i}
          onClick={() => enableLightbox && onImageClick(i)}
          style={{
            overflow: "hidden",
            cursor: enableLightbox ? "pointer" : "default",
          }}
        >
          <img
            src={img.src}
            alt={img.alt || `Gallery image ${i + 1}`}
            style={{
              width: "100%",
              height: imageHeight,
              objectFit,
              display: "block",
              transition: "transform 0.3s ease",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLImageElement).style.transform = "scale(1.03)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLImageElement).style.transform = "scale(1)";
            }}
          />
        </div>
      ))}
    </div>
  );
}

// ─── Carousel Mode ───────────────────────────────────────────────────────────

function CarouselGallery({
  images,
  gap,
  imageHeight,
  objectFit,
  showArrows,
  enableLightbox,
  itemsPerView,
  onImageClick,
}: {
  images: GalleryImage[];
  gap: number;
  imageHeight: string;
  objectFit: "cover" | "contain";
  showArrows: boolean;
  enableLightbox: boolean;
  itemsPerView: number;
  onImageClick: (index: number) => void;
}) {
  const [offset, setOffset] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);

  const maxOffset = Math.max(0, images.length - itemsPerView);

  const next = useCallback(() => {
    setOffset((prev) => Math.min(prev + 1, maxOffset));
  }, [maxOffset]);

  const prev = useCallback(() => {
    setOffset((prev) => Math.max(prev - 1, 0));
  }, []);

  // Calculate item width percentage
  const itemWidthPercent = 100 / itemsPerView;
  const gapOffset = gap * (itemsPerView - 1) / itemsPerView;

  return (
    <div style={{ position: "relative" }}>
      {/* Arrows */}
      {showArrows && images.length > itemsPerView && (
        <>
          <button
            type="button"
            onClick={prev}
            disabled={offset === 0}
            aria-label="Previous"
            style={{
              position: "absolute",
              left: -8,
              top: "50%",
              transform: "translateY(-50%)",
              zIndex: 10,
              width: 36,
              height: 36,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "#fff",
              border: "1px solid #E8E4DF",
              borderRadius: "50%",
              color: offset === 0 ? "#ccc" : "#2C2C2C",
              cursor: offset === 0 ? "default" : "pointer",
              boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
            }}
          >
            <ChevronLeft size={18} strokeWidth={1.5} />
          </button>
          <button
            type="button"
            onClick={next}
            disabled={offset >= maxOffset}
            aria-label="Next"
            style={{
              position: "absolute",
              right: -8,
              top: "50%",
              transform: "translateY(-50%)",
              zIndex: 10,
              width: 36,
              height: 36,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "#fff",
              border: "1px solid #E8E4DF",
              borderRadius: "50%",
              color: offset >= maxOffset ? "#ccc" : "#2C2C2C",
              cursor: offset >= maxOffset ? "default" : "pointer",
              boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
            }}
          >
            <ChevronRight size={18} strokeWidth={1.5} />
          </button>
        </>
      )}

      {/* Track */}
      <div style={{ overflow: "hidden" }}>
        <div
          ref={trackRef}
          style={{
            display: "flex",
            gap: `${gap}px`,
            transform: `translateX(-${offset * (itemWidthPercent + (gap * 100) / (itemsPerView * (trackRef.current?.offsetWidth || 1)))}%)`,
            transition: "transform 0.4s ease",
          }}
        >
          {images.map((img, i) => (
            <div
              key={i}
              onClick={() => enableLightbox && onImageClick(i)}
              style={{
                flex: `0 0 calc(${itemWidthPercent}% - ${gapOffset}px)`,
                overflow: "hidden",
                cursor: enableLightbox ? "pointer" : "default",
              }}
            >
              <img
                src={img.src}
                alt={img.alt || `Gallery image ${i + 1}`}
                style={{
                  width: "100%",
                  height: imageHeight,
                  objectFit,
                  display: "block",
                  transition: "transform 0.3s ease",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLImageElement).style.transform = "scale(1.03)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLImageElement).style.transform = "scale(1)";
                }}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Main Gallery Runtime ────────────────────────────────────────────────────

export function GalleryRuntime({
  images,
  mode,
  columns,
  gap,
  imageHeight,
  objectFit,
  borderRadius,
  showArrows,
  enableLightbox,
  itemsPerView,
}: GalleryRuntimeProps) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const openLightbox = (index: number) => setLightboxIndex(index);
  const closeLightbox = () => setLightboxIndex(null);

  const goNext = useCallback(() => {
    setLightboxIndex((prev) =>
      prev !== null ? (prev + 1) % images.length : null
    );
  }, [images.length]);

  const goPrev = useCallback(() => {
    setLightboxIndex((prev) =>
      prev !== null ? (prev - 1 + images.length) % images.length : null
    );
  }, [images.length]);

  if (images.length === 0) {
    return (
      <div
        style={{
          height: 200,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#F2EDE3",
          color: "#6B6B6B",
          fontSize: 14,
        }}
      >
        Add images to the gallery
      </div>
    );
  }

  return (
    <>
      {mode === "grid" ? (
        <GridGallery
          images={images}
          columns={columns}
          gap={gap}
          imageHeight={imageHeight}
          objectFit={objectFit}
          enableLightbox={enableLightbox}
          onImageClick={openLightbox}
        />
      ) : (
        <CarouselGallery
          images={images}
          gap={gap}
          imageHeight={imageHeight}
          objectFit={objectFit}
          showArrows={showArrows}
          enableLightbox={enableLightbox}
          itemsPerView={itemsPerView}
          onImageClick={openLightbox}
        />
      )}

      {lightboxIndex !== null && (
        <Lightbox
          images={images}
          currentIndex={lightboxIndex}
          onClose={closeLightbox}
          onNext={goNext}
          onPrev={goPrev}
        />
      )}
    </>
  );
}
