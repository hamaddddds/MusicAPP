import * as React from "react"
import * as SliderPrimitive from "@radix-ui/react-slider"

import { cn } from "@/lib/utils"

const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>
>(({ className, orientation = "horizontal", ...props }, ref) => (
  <SliderPrimitive.Root
    ref={ref}
    orientation={orientation}
    className={cn(
      "relative flex touch-none select-none group items-center",
      orientation === "horizontal" ? "w-full" : "h-full justify-center flex-col w-full",
      className
    )}
    {...props}
  >
    <SliderPrimitive.Track className={cn(
      "relative grow overflow-hidden rounded-full",
      orientation === "horizontal" ? "h-1.5 w-full bg-white/20" : "w-1.5 h-full bg-white/20"
    )}>
      <SliderPrimitive.Range className={cn(
        "absolute rounded-full transition-colors duration-200 bg-white",
        orientation === "horizontal" ? "h-full" : "w-full"
      )} />
    </SliderPrimitive.Track>
    <SliderPrimitive.Thumb className="block h-4 w-4 rounded-full bg-white border border-white/50 shadow-[0_2px_8px_rgba(0,0,0,0.5)] transition-shadow duration-200 hover:shadow-[0_2px_12px_rgba(255,255,255,0.25)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50" />
  </SliderPrimitive.Root>
))
Slider.displayName = SliderPrimitive.Root.displayName

export { Slider }
