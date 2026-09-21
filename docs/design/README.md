# Ant Design System Documentation & Agent Reference

This directory holds the definitive design system specifications and component API references for the **ShipVerify** frontend:

## Directory Contents

| File | Purpose | Contents |
| :--- | :--- | :--- |
| [`design.md`](./design.md) | **Design System Tokens & Philosophy** | Ant Design v6 specifications: color palette (primary, state seeds, neutrals), typography (14px base, 400/600 weights), 4px grid spacing, 3-layer surface model (`bg-layout`, `bg-container`, `bg-elevated`), 6px control radius, elevation/shadows, and animation easings. |
| [`antd-components.md`](./antd-components.md) | **Comprehensive Component Reference** | Full documentation and API props for all 75 Ant Design components (Button, Table, Form, Drawer, Modal, Tag, Badge, Tabs, Steps, Descriptions, Timeline, etc.). |

---

## Agentic Development Guidelines

When developing or refactoring frontend components:

1. **Exact Props & Types**:
   - Query `antd-components.md` (using `grep_search` or slice reading) for component props, slots, and events before implementing or updating a component.
   - Avoid hallucinating props or using deprecated APIs.

2. **Design Tokens & Theming**:
   - Review `design.md` for proper color variables, spacing scale (4px / 8px / 16px / 24px / 32px), and corner radiuses.
   - Rely on `ConfigProvider` tokens and `App.useApp()` for UI state and dialogs instead of hard-coding magic values.

3. **Icons**:
   - Import icons from `@ant-design/icons` (e.g., `import { DashboardOutlined, CheckCircleFilled } from '@ant-design/icons'`).
