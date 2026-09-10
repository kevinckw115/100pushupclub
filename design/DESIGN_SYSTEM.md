# Cream & Brick — design system

The user approved [Option 5](option-5-cream-brick.png). [tokens.json](tokens.json) is the canonical palette and dimension source. Generated pixels can vary; implement the explicit tokens, not sampled gradients or the phone frame.

## Palette

| Token | Hex | Use |
|---|---|---|
| canvas | #F5EBDD | App background, warm cream |
| surface | #F9F1E6 | Sheets and subtly raised surfaces |
| accent | #903F38 | Main action, selected tab, filled ring |
| accentPressed | #79332E | Pressed action |
| textPrimary | #3D2D28 | Headings, counts, body |
| textSecondary | #76665D | Supporting labels |
| track | #E3D6C6 | Decorative progress remainder |
| divider | #DED1C1 | Nonessential separators |
| onAccent | #F5EBDD | Text on brick buttons |
| focus | #903F38 | Accessible focus outline |

No white cards on white backgrounds, green accents from earlier options, pure-black typography, clay-orange buttons, gradients, shadows on every row, or paper texture. Thin decorative dividers need not identify controls; actual inputs have a stronger secondary-text-color outline. Disabled controls remain recognizable using text and state, not barely visible opacity alone. Red is the brand accent, so errors must also have a label/icon and explicit explanation.

## Type and layout

Use system sans-serif initially: native iOS system font and Android system sans. No font download dependency. Aim for the reference's compact, sturdy headings. Do not force exact identical glyph shapes between platforms. Use tabular numerals for counts where supported.

| Style | Size / line height | Weight |
|---|---|---|
| Wordmark | 24 / 30 | 700 |
| Screen title | 28 / 34 | 700 |
| Hero headline | 30 / 36 | 700 |
| Count | 88 / 96 | 700 |
| Section | 18 / 24 | 600 |
| Body/button | 16 / 24 | 400 / 600 |
| Caption | 13 / 18 | 400 |
| Navigation label | 11 / 16 | 500 |

Default content inset 24 logical pixels (20 on widths below 375). Spacing scale 4/8/12/16/24/32/40. Buttons at least 52 high; every tap target at least 48×48, including small icon hitSlop. Corners 12 for buttons, 24 for sheets. Safe areas are native insets, not hard-coded mock status bars.

Today uses a scroll container above fixed bottom navigation. Ring nominal diameter 232 and stroke 14; shrink toward 200 on compact screens. Limit content width to 480 on tablets with centered content. Never clip headline or count to preserve screenshot proportions. Dynamic text may wrap, increase height, and scroll. At 200% text size all core tasks remain possible.

## Components

AppScreen, Header, PrimaryButton, SecondaryButton, IconButton, ProgressRing, QuantityInput, PresetChip, CheckinRow, FeedRow, StatPanel, ScopeSelector, BottomSheet, InlineNotice, EmptyState, ToastWithUndo, TabBar, DaySummary, MemberRow.

Use one icon family available through the chosen Expo toolchain. Icons are secondary to labels. No trophy, fire, flexing arm, badges, confetti, or profile photos. Selected tabs combine filled/stroked state and accent text so color is not the only cue.

Progress ring starts at 12 o'clock clockwise. Accessibility label: “35 pushups today, goal 100.” It is a display, not an adjustable slider. Screen reader announces one save confirmation, not every animated intermediate count.

## Interaction and motion

Animate progress over 180–240 ms; sheet transition follows native behavior. Haptic on successful local commit only; optional setting, silent fallback. Respect reduced motion and remove count tweening under that setting. No infinite pulsing live indicator. New-feed rows do not steal focus or jump scroll position.

Keyboard-aware sheet: number-pad input can be typed directly, presets replace quantity rather than add, plus/minus change by 1. Initial quantity 10 each open for predictability. Number entry receives screen-reader labels and handles paste. User dismissing a draft changes nothing. Save is disabled during local commit; after success sheet closes once.

## Copy principles

Short, concrete, no guilt or inflated praise. “Start with a few.” “10 added.” “Saved on this phone. Will sync when connected.” “No check-ins here yet.” Completion: “100 today. Nicely done.” Returning: “Welcome back. Start where you are.” Reminder: “A few pushups when you're ready.” Do not promise physical outcomes or imply that 100 every day is required for belonging.

## Required visual review set

Capture Today at 0, 35, 100, 125; quantity sheet with keyboard; community empty and populated; circle empty and populated; history; onboarding/settings; offline and conflict states. Use small and standard iPhone and Android sizes plus 200% text. Review spacing, legibility, thumb reach, safe areas, keyboard overlap and cream/red balance. Compare functional screens, not a phone frame or board label.
