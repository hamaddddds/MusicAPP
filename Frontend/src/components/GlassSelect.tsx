import * as Menu from "@radix-ui/react-dropdown-menu";
import { Check, ChevronsUpDown } from "lucide-react";

export interface GlassOption { value: string; label: string; hint?: string }

interface Props {
  value: string;
  onChange: (value: string) => void;
  options: GlassOption[];
  label: string;
  side?: "top" | "bottom";
  className?: string;
}

/** Liquid-glass select: Radix menu (keyboard, typeahead, focus return) dressed like Apple Music's pop-up buttons. */
export default function GlassSelect({ value, onChange, options, label, side = "bottom", className = "" }: Props) {
  const current = options.find(option => option.value === value);
  return <Menu.Root>
    <Menu.Trigger className={`glass-select ${className}`} aria-label={label}>
      <span>{current?.label ?? "Select…"}</span>
      <ChevronsUpDown size={13} aria-hidden />
    </Menu.Trigger>
    <Menu.Portal>
      <Menu.Content className="glass-menu" side={side} align="end" sideOffset={10} collisionPadding={12} loop>
        <Menu.Label className="glass-menu-label">{label}</Menu.Label>
        <Menu.RadioGroup value={value} onValueChange={onChange}>
          {options.map(option => <Menu.RadioItem key={option.value} value={option.value} className="glass-menu-item">
            <span className="glass-menu-text">{option.label}{option.hint && <small>{option.hint}</small>}</span>
            <Menu.ItemIndicator className="glass-menu-check"><Check size={15} strokeWidth={2.5} /></Menu.ItemIndicator>
          </Menu.RadioItem>)}
        </Menu.RadioGroup>
      </Menu.Content>
    </Menu.Portal>
  </Menu.Root>;
}
