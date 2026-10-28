import { useTable } from "@refinedev/antd";
import type { BaseRecord, CrudFilters } from "@refinedev/core";
import { App, Button, Form, Input, Select, Space } from "antd";
import type { ReactNode } from "react";
import { api } from "../api";

/** 列表页通用：关键字 + 可选状态筛选，提交后作为 keyword/status 传给后端 */
export const useAdminTable = <T extends BaseRecord>(resource: string) =>
    useTable<T, any, { keyword?: string; status?: string }>({
        resource,
        pagination: { pageSize: 20 },
        onSearch: (v): CrudFilters => [
            { field: "keyword", operator: "eq", value: v.keyword?.trim() || undefined },
            { field: "status", operator: "eq", value: v.status || undefined },
        ],
    });

export const SearchBar = ({
    formProps,
    placeholder,
    statusOptions,
    extra,
}: {
    formProps: any;
    placeholder: string;
    statusOptions?: { label: string; value: string }[];
    extra?: ReactNode;
}) => (
    <Form {...formProps} layout="inline" style={{ marginBottom: 16 }}>
        <Form.Item name="keyword">
            <Input allowClear placeholder={placeholder} style={{ width: 240 }} />
        </Form.Item>
        {statusOptions && (
            <Form.Item name="status">
                <Select allowClear placeholder="状态" options={statusOptions} style={{ width: 140 }} />
            </Form.Item>
        )}
        <Form.Item>
            <Space>
                <Button type="primary" htmlType="submit">
                    查询
                </Button>
                {extra}
            </Space>
        </Form.Item>
    </Form>
);

/** 执行一个后台操作：成功提示并回调刷新，失败展示后端返回的原因 */
export const useAction = () => {
    const { message } = App.useApp();
    return async (path: string, body: unknown, okText: string, after?: () => unknown) => {
        try {
            const data = await api(path, body);
            message.success(okText);
            await after?.();
            return data;
        } catch (e) {
            message.error((e as Error).message);
            return undefined;
        }
    };
};

/** 表单校验：值为空或合法的 JSON 对象 */
export const jsonRule = {
    validator: (_: unknown, v: string) => {
        if (!v || !v.trim()) return Promise.resolve();
        try {
            const parsed = JSON.parse(v);
            return parsed && typeof parsed === "object" && !Array.isArray(parsed)
                ? Promise.resolve()
                : Promise.reject(new Error("需要是 JSON 对象"));
        } catch {
            return Promise.reject(new Error("不是合法的 JSON"));
        }
    },
};
