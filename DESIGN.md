# Harness Design System

> Based on Open Design methodology. Clean, modern, developer-tool aesthetic.

## Brand

- **Name:** Harness
- **Purpose:** Coding Agent harness — developer tool
- **Vibe:** Clean, professional, trustworthy, technical

## Colors

### Primary palette
```css
--color-primary: #2563eb;       /* Blue-600 — buttons, links, active */
--color-primary-hover: #1d4ed8; /* Blue-700 */
--color-primary-light: #eff6ff; /* Blue-50 — backgrounds */
--color-primary-ring: #93c5fd;  /* Blue-300 — focus ring */
```

### Neutral palette
```css
--color-bg: #f8fafc;           /* Slate-50 — page background */
--color-surface: #ffffff;       /* Cards, panels */
--color-surface-hover: #f1f5f9; /* Slate-100 */
--color-border: #e2e8f0;       /* Slate-200 */
--color-border-light: #f1f5f9; /* Slate-100 */
--color-text: #1e293b;         /* Slate-800 — primary text */
--color-text-secondary: #64748b; /* Slate-500 */
--color-text-muted: #94a3b8;   /* Slate-400 */
--color-text-inverse: #ffffff;
```

### Semantic palette
```css
--color-success: #22c55e;      /* Green-500 */
--color-success-bg: #f0fdf4;   /* Green-50 */
--color-warning: #f59e0b;      /* Amber-500 */
--color-warning-bg: #fffbeb;   /* Amber-50 */
--color-danger: #ef4444;       /* Red-500 */
--color-danger-bg: #fef2f2;    /* Red-50 */
--color-danger-hover: #dc2626; /* Red-600 */
--color-info: #3b82f6;         /* Blue-500 */
--color-info-bg: #eff6ff;      /* Blue-50 */
```

## Typography

```css
--font-family: 'Inter', system-ui, -apple-system, sans-serif;
--font-mono: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
--font-size-xs: 11px;
--font-size-sm: 13px;
--font-size-base: 14px;
--font-size-lg: 16px;
--font-size-xl: 20px;
--font-size-2xl: 24px;
--font-weight-normal: 400;
--font-weight-medium: 500;
--font-weight-semibold: 600;
--font-weight-bold: 700;
--line-height: 1.5;
```

## Spacing

```css
--space-1: 4px;
--space-2: 8px;
--space-3: 12px;
--space-4: 16px;
--space-5: 20px;
--space-6: 24px;
--space-8: 32px;
```

## Borders & Radius

```css
--radius-sm: 4px;
--radius-md: 6px;
--radius-lg: 8px;
--radius-full: 9999px;
--border-width: 1px;
```

## Shadows

```css
--shadow-sm: 0 1px 2px 0 rgba(0,0,0,0.05);
--shadow-md: 0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -2px rgba(0,0,0,0.1);
--shadow-lg: 0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -4px rgba(0,0,0,0.1);
```

## Component Specs

### Input
- Background: white
- Border: 1px solid `--color-border`, radius `--radius-md`
- Padding: 8px 12px
- Font: `--font-size-base`, `--color-text`
- Focus: ring `--color-primary-ring` 3px
- Disabled: `--color-surface-hover` background, `--color-text-muted` text

### Button — Primary
- Background: `--color-primary`, text: white
- Hover: `--color-primary-hover`
- Radius: `--radius-md`
- Padding: 8px 16px
- Font: `--font-size-sm`, `--font-weight-medium`
- Disabled: opacity 0.5

### Button — Danger
- Background: `--color-danger`, text: white
- Hover: `--color-danger-hover`

### Button — Secondary
- Background: white, border: `--color-border`, text: `--color-text`
- Hover: `--color-surface-hover`

### Card
- Background: white
- Border: `--color-border`, radius: `--radius-lg`
- Padding: 16px
- Shadow: `--shadow-sm`
- Hover: `--shadow-md`

### Badge
- Radius: `--radius-full`
- Padding: 2px 8px
- Font: `--font-size-xs`, `--font-weight-semibold`
- Text: white

### Timeline
- Vertical line: 2px solid `--color-border`
- Node: 12px circle, colored by status
- Gap: 16px between items

### Code Block
- Font: `--font-mono`, size: `--font-size-sm`
- Background: `--color-surface-hover`
- Radius: `--radius-sm`
- Padding: 8px

## Layout

- Max width: 960px
- Side padding: 24px
- Header: 56px height, white background, bottom border
- Nav tabs: 14px, medium weight, active has bottom border