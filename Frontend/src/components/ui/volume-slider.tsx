"use client";

import { Volume2, Volume1, VolumeX } from "lucide-react";
import * as RadixSlider from "@radix-ui/react-slider";
import {
  animate,
  motion,
  useMotionValue,
  useMotionValueEvent,
  useTransform,
} from "framer-motion";
import { ElementRef, useRef, useState } from "react";

const MAX_OVERFLOW = 50;

interface VolumeSliderProps {
  value: number; // 0..100
  onChange: (value: number) => void;
  onMuteToggle: () => void;
  muted: boolean;
}

export function VolumeSlider({ value, onChange, onMuteToggle, muted }: VolumeSliderProps) {
  const [region, setRegion] = useState("middle");
  const clientX = useMotionValue(0);
  const overflow = useMotionValue(0);
  const scale = useMotionValue(1);
  const ref = useRef<ElementRef<typeof RadixSlider.Root>>(null);

  useMotionValueEvent(clientX, "change", (latest) => {
    if (ref.current) {
      const { left, right } = ref.current.getBoundingClientRect();
      let newValue;

      if (latest < left) {
        setRegion("left");
        newValue = left - latest;
      } else if (latest > right) {
        setRegion("right");
        newValue = latest - right;
      } else {
        setRegion("middle");
        newValue = 0;
      }

      overflow.jump(decay(newValue, MAX_OVERFLOW));
    }
  });

  const effective = muted ? 0 : value;
  const VolIcon = effective === 0 ? VolumeX : effective < 50 ? Volume1 : Volume2;

  return (
    <motion.div
      onHoverStart={() => animate(scale, 1.15)}
      onHoverEnd={() => animate(scale, 1)}
      onTouchStart={() => animate(scale, 1.15)}
      onTouchEnd={() => animate(scale, 1)}
      style={{ scale, opacity: useTransform(scale, [1, 1.15], [0.75, 1]) }}
      className="flex w-full touch-none select-none items-center justify-center gap-2"
    >
      <motion.button
        type="button"
        onClick={onMuteToggle}
        title={muted ? "Unmute" : "Mute"}
        animate={{
          scale: region === "left" ? [1, 1.4, 1] : 1,
          transition: { duration: 0.25 },
        }}
        style={{
          x: useTransform(() =>
            region === "left" ? -overflow.get() / scale.get() : 0
          ),
        }}
        className="vol-toggle"
      >
        <VolIcon className="size-5 text-current" />
      </motion.button>

      <RadixSlider.Root
        ref={ref}
        value={[effective]}
        onValueChange={([v]) => onChange(Math.floor(v))}
        step={0.5}
        className="vol-root relative flex w-full min-w-[120px] grow cursor-grab touch-none select-none items-center py-4 active:cursor-grabbing"
        onPointerMove={(e) => {
          if (e.buttons > 0) clientX.jump(e.clientX);
        }}
        onLostPointerCapture={() => {
          animate(overflow, 0, { type: "spring", bounce: 0.5 });
        }}
      >
        <motion.div
          style={{
            scaleX: useTransform(() => {
              if (ref.current) {
                const { width } = ref.current.getBoundingClientRect();
                return 1 + overflow.get() / width;
              }
            }),
            scaleY: useTransform(overflow, [0, MAX_OVERFLOW], [1, 0.8]),
            transformOrigin: useTransform(() => {
              if (ref.current) {
                const { left, width } = ref.current.getBoundingClientRect();
                return clientX.get() < left + width / 2 ? "right" : "left";
              }
            }),
            height: useTransform(scale, [1, 1.15], [5, 10]),
            marginTop: useTransform(scale, [1, 1.15], [0, -2.5]),
            marginBottom: useTransform(scale, [1, 1.15], [0, -2.5]),
          }}
          className="flex grow"
        >
          <RadixSlider.Track className="vol-track relative isolate h-full grow overflow-hidden rounded-full">
            <RadixSlider.Range className="vol-range absolute h-full" />
          </RadixSlider.Track>
        </motion.div>
        <RadixSlider.Thumb className="vol-thumb" />
      </RadixSlider.Root>

      <motion.div
        animate={{
          scale: region === "right" ? [1, 1.4, 1] : 1,
          transition: { duration: 0.25 },
        }}
        style={{
          x: useTransform(() =>
            region === "right" ? overflow.get() / scale.get() : 0
          ),
        }}
        className="vol-pct"
      >
        {Math.round(effective)}%
      </motion.div>
    </motion.div>
  );
}

// Sigmoid-based decay function
function decay(value: number, max: number) {
  if (max === 0) return 0;
  const entry = value / max;
  const sigmoid = 2 * (1 / (1 + Math.exp(-entry)) - 0.5);
  return sigmoid * max;
}

export default VolumeSlider;
