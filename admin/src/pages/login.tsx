import { ThemedTitle } from "@refinedev/antd";
import { useLogin } from "@refinedev/core";
import { Button, Card, Form, Input, Space } from "antd";
import { useState } from "react";
import { api } from "../api";

// 自定义登录页：Refine 自带的 AuthPage 不支持图形验证码；
// 后端在连续失败后会要求验证码（CaptchaRequired），这里按需显示
export const LoginPage = () => {
    const [form] = Form.useForm();
    const { mutate: login, isPending } = useLogin();
    const [captcha, setCaptcha] = useState<{ id: string; svg: string } | null>(null);

    const loadCaptcha = async () => {
        try {
            setCaptcha(await api<{ id: string; svg: string }>("auth/captcha"));
            form.setFieldValue("captchaCode", "");
        } catch {
            setCaptcha(null);
        }
    };

    const onFinish = (v: { email: string; password: string; captchaCode?: string }) => {
        // 失败原因由 Refine 的通知统一展示；这里只决定是否显示/刷新图形验证码
        login(
            { ...v, captchaId: captcha?.id },
            {
                onSuccess: (r: any) => {
                    if (r?.success) return;
                    if (r?.captchaRequired || captcha) loadCaptcha();
                },
            },
        );
    };

    return (
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f5f5f5" }}>
            <Card style={{ width: 380 }}>
                <div style={{ marginBottom: 24, textAlign: "center" }}>
                    <ThemedTitle collapsed={false} text="管理后台" />
                </div>
                <Form form={form} layout="vertical" onFinish={onFinish} requiredMark={false}>
                    <Form.Item name="email" label="邮箱" rules={[{ required: true, type: "email", message: "请输入邮箱" }]}>
                        <Input id="email" autoComplete="email" />
                    </Form.Item>
                    <Form.Item name="password" label="密码" rules={[{ required: true, message: "请输入密码" }]}>
                        <Input.Password id="password" autoComplete="current-password" />
                    </Form.Item>
                    {captcha && (
                        <Form.Item label="图形验证码" required>
                            <Space.Compact style={{ width: "100%" }}>
                                <Form.Item name="captchaCode" noStyle rules={[{ required: true, message: "请输入验证码" }]}>
                                    <Input id="captchaCode" maxLength={6} autoComplete="off" />
                                </Form.Item>
                                <span
                                    title="看不清？点击换一张"
                                    onClick={loadCaptcha}
                                    style={{ cursor: "pointer", flex: "none", width: 96, height: 32, overflow: "hidden", border: "1px solid #d9d9d9", borderLeft: 0, background: "#fff" }}
                                    // 内容是后端 svg-captcha 生成的 SVG，不含用户输入；按 viewBox 等比缩放到输入框高度
                                    dangerouslySetInnerHTML={{ __html: captcha.svg.replace(/width="\d+" height="\d+"/, 'width="96" height="32"') }}
                                />
                            </Space.Compact>
                        </Form.Item>
                    )}
                    <Button type="primary" htmlType="submit" block loading={isPending}>
                        登录
                    </Button>
                </Form>
            </Card>
        </div>
    );
};
