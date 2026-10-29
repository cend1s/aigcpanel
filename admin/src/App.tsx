import {
    AuditOutlined,
    CloudServerOutlined,
    CrownOutlined,
    DashboardOutlined,
    GiftOutlined,
    ShoppingCartOutlined,
    ThunderboltOutlined,
    UserOutlined,
} from "@ant-design/icons";
import { ErrorComponent, ThemedLayout, ThemedTitle, useNotificationProvider } from "@refinedev/antd";
import "@refinedev/antd/dist/reset.css";
import { Authenticated, Refine } from "@refinedev/core";
import routerProvider, { CatchAllNavigate, DocumentTitleHandler, NavigateToResource } from "@refinedev/react-router";
import { App as AntdApp, ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import "dayjs/locale/zh-cn";
import { useEffect, useState } from "react";
import { BrowserRouter, Outlet, Route, Routes } from "react-router";
import { DashboardPage } from "./pages/dashboard";
import { LoginPage } from "./pages/login";
import { AuditList, TaskList } from "./pages/logs";
import { ModelCreate, ModelEdit, ModelList } from "./pages/models";
import { OrderList } from "./pages/orders";
import { PlanCreate, PlanEdit, PlanList } from "./pages/plans";
import { RedemptionList } from "./pages/redemptions";
import { UserList } from "./pages/users";
import { i18nProvider } from "./i18n";
import { authProvider, dataProvider } from "./providers";

const resources = [
    { name: "dashboard", list: "/", meta: { label: "概览", icon: <DashboardOutlined /> } },
    { name: "user", list: "/users", meta: { label: "用户", icon: <UserOutlined /> } },
    { name: "order", list: "/orders", meta: { label: "订单", icon: <ShoppingCartOutlined /> } },
    { name: "redemption", list: "/redemptions", meta: { label: "兑换码", icon: <GiftOutlined /> } },
    { name: "plan", list: "/plans", create: "/plans/create", edit: "/plans/edit/:id", meta: { label: "套餐", icon: <CrownOutlined /> } },
    { name: "model", list: "/models", create: "/models/create", edit: "/models/edit/:id", meta: { label: "云端模型", icon: <CloudServerOutlined /> } },
    { name: "task", list: "/tasks", meta: { label: "云端任务", icon: <ThunderboltOutlined /> } },
    { name: "audit", list: "/audit", meta: { label: "审计日志", icon: <AuditOutlined /> } },
];

// 标题旁显示服务端版本，便于确认部署的是哪一次构建
const useServerVersion = () => {
    const [version, setVersion] = useState("");
    useEffect(() => {
        fetch("/api/version")
            .then((r) => r.json())
            .then((r) => setVersion(r?.data?.version ?? ""))
            .catch(() => undefined);
    }, []);
    return version;
};
const Title = (props: { collapsed: boolean }) => {
    const version = useServerVersion();
    return <ThemedTitle {...props} text={version ? `管理后台 ${version}` : "管理后台"} />;
};

export default function App() {
    return (
        <BrowserRouter basename="/admin">
            <ConfigProvider locale={zhCN}>
                <AntdApp>
                    <Refine
                        dataProvider={dataProvider}
                        authProvider={authProvider}
                        i18nProvider={i18nProvider}
                        routerProvider={routerProvider}
                        notificationProvider={useNotificationProvider}
                        resources={resources}
                        options={{ syncWithLocation: true, warnWhenUnsavedChanges: true, disableTelemetry: true }}
                    >
                        <Routes>
                            <Route
                                element={
                                    <Authenticated key="authed" fallback={<CatchAllNavigate to="/login" />}>
                                        <ThemedLayout Title={Title}>
                                            <Outlet />
                                        </ThemedLayout>
                                    </Authenticated>
                                }
                            >
                                <Route index element={<DashboardPage />} />
                                <Route path="/users" element={<UserList />} />
                                <Route path="/orders" element={<OrderList />} />
                                <Route path="/redemptions" element={<RedemptionList />} />
                                <Route path="/plans">
                                    <Route index element={<PlanList />} />
                                    <Route path="create" element={<PlanCreate />} />
                                    <Route path="edit/:id" element={<PlanEdit />} />
                                </Route>
                                <Route path="/models">
                                    <Route index element={<ModelList />} />
                                    <Route path="create" element={<ModelCreate />} />
                                    <Route path="edit/:id" element={<ModelEdit />} />
                                </Route>
                                <Route path="/tasks" element={<TaskList />} />
                                <Route path="/audit" element={<AuditList />} />
                                <Route path="*" element={<ErrorComponent />} />
                            </Route>
                            <Route
                                element={
                                    <Authenticated key="anon" fallback={<Outlet />}>
                                        <NavigateToResource resource="dashboard" />
                                    </Authenticated>
                                }
                            >
                                <Route path="/login" element={<LoginPage />} />
                            </Route>
                        </Routes>
                        <DocumentTitleHandler handler={({ resource }) => `${resource?.meta?.label ?? "管理后台"} · 管理后台`} />
                    </Refine>
                </AntdApp>
            </ConfigProvider>
        </BrowserRouter>
    );
}
