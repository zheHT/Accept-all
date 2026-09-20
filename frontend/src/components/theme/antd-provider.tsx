"use client";

import React, { useMemo } from "react";
import { ConfigProvider, App, theme as antdTheme, type ThemeConfig } from "antd";
import { useTheme } from "./theme-provider";

const FONT_FEATURE_SETTINGS = '"tnum"';

export function AntdProvider({ children }: { children: React.ReactNode }) {
  const { theme, mounted } = useTheme();

  const themeConfig: ThemeConfig = useMemo(() => {
    const isDark = mounted ? theme === "dark" : false;

    return {
      algorithm: isDark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
      token: {
        colorPrimary: "#1677FF",
        colorSuccess: "#52C41A",
        colorWarning: "#FAAD14",
        colorError: "#FF4D4F",
        colorInfo: "#1677FF",
        borderRadius: 6,
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif",
        fontFamilyCode:
          "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
        fontFeatureSettings: FONT_FEATURE_SETTINGS,
        fontSize: 14,
        lineHeight: 1.5,
        motionDurationFast: "0.1s",
        motionDurationMid: "0.2s",
        motionDurationSlow: "0.3s",
      } as NonNullable<ThemeConfig["token"]> & { fontFeatureSettings: string },
      components: {
        Button: {
          controlHeight: 34,
          borderRadius: 6,
          fontWeight: 500,
        },
        Table: {
          headerBg: isDark ? "#161b22" : "#f8fafc",
          headerColor: isDark ? "#e2e8f0" : "#1e293b",
          rowHoverBg: isDark ? "rgba(255, 255, 255, 0.03)" : "rgba(22, 119, 255, 0.03)",
          borderColor: isDark ? "#30363d" : "#e2e8f0",
          borderRadius: 8,
          fontSize: 13,
        },
        Card: {
          borderRadiusLG: 8,
          colorBorderSecondary: isDark ? "#30363d" : "#e2e8f0",
        },
        Drawer: {
          borderRadiusLG: 8,
        },
        Modal: {
          borderRadiusLG: 8,
        },
        Tag: {
          borderRadiusSM: 4,
          fontSize: 12,
        },
        Statistic: {
          contentFontSize: 24,
          titleFontSize: 12,
        },
        Segmented: {
          trackBg: isDark ? "#21262d" : "#f1f5f9",
          itemSelectedBg: isDark ? "#30363d" : "#ffffff",
          borderRadius: 6,
        },
        Input: {
          controlHeight: 34,
          borderRadius: 6,
        },
        Select: {
          controlHeight: 34,
          borderRadius: 6,
        },
        Badge: {
          fontSize: 11,
        },
        Steps: {
          fontSize: 12,
          iconSize: 24,
        },
        Progress: {
          lineBorderRadius: 100,
        },
        Popconfirm: {
          fontSize: 13,
        },
        Skeleton: {
          borderRadiusSM: 6,
        },
      },
    };
  }, [theme, mounted]);

  return (
    <ConfigProvider theme={themeConfig}>
      <App style={{ fontFeatureSettings: FONT_FEATURE_SETTINGS }}>{children}</App>
    </ConfigProvider>
  );
}
