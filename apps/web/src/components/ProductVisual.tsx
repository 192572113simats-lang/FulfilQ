import { Box, Cpu, Headphones, Lamp, Package, Printer, ScanBarcode, Wrench } from 'lucide-react';

function iconForCategory(category: string) {
  switch (category) {
    case 'Hardware':
      return ScanBarcode;
    case 'Electronics':
      return Cpu;
    case 'Audio':
      return Headphones;
    case 'Lighting':
      return Lamp;
    case 'Packaging':
      return Package;
    case 'Storage':
      return Box;
    default:
      return Wrench;
  }
}

export function ProductVisual({
  category,
  sku,
  name,
  compact = false,
}: {
  category: string;
  sku: string;
  name: string;
  compact?: boolean;
}) {
  const Icon = category === 'Hardware' && name.includes('Printer') ? Printer : iconForCategory(category);

  return (
    <div
      className={`relative w-full bg-slate-100 border-b border-slate-200 flex flex-col items-center justify-center select-none ${
        compact ? 'h-24' : 'aspect-[4/3]'
      }`}
      aria-hidden="true"
    >
      <div className="w-12 h-12 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-slate-700">
        <Icon className="w-6 h-6" />
      </div>
      <span className="mt-2 font-mono text-xs text-slate-500 tracking-wide">{sku}</span>
    </div>
  );
}
