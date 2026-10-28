import { List } from "@refinedev/antd";
import { Button, Drawer, Form, Input, InputNumber, Modal, Popconfirm, Space, Table, Tag } from "antd";
import { useState } from "react";
import { api } from "../api";
import { REASONS, time } from "../format";
import { SearchBar, useAction, useAdminTable } from "./common";

type UserRow = { id: number; email: string; nickname: string; status: number; role: number; quota: number; usedQuota: number; createdAt: number };

const Ledger = ({ user, onClose }: { user: UserRow | null; onClose: () => void }) => {
    const [page, setPage] = useState(1);
    const [data, setData] = useState<{ records: any[]; total: number }>({ records: [], total: 0 });
    const load = (p: number) => {
        if (!user) return;
        setPage(p);
        api("admin/user/ledger", { userId: user.id, page: p, pageSize: 20 }).then(setData).catch(() => undefined);
    };
    return (
        <Drawer
            width={640}
            open={!!user}
            onClose={onClose}
            title={`额度流水 · ${user?.email ?? ""}`}
            afterOpenChange={(open) => open && load(1)}
            destroyOnClose
        >
            <Table
                rowKey="id"
                size="small"
                dataSource={data.records}
                pagination={{ current: page, total: data.total, pageSize: 20, onChange: load }}
                columns={[
                    { title: "时间", dataIndex: "createdAt", render: time },
                    { title: "类型", dataIndex: "reason", render: (r) => REASONS[r] ?? r },
                    { title: "变动", dataIndex: "delta", render: (d) => <span style={{ color: d > 0 ? "#389e0d" : "#cf1322" }}>{d > 0 ? `+${d}` : d}</span> },
                    { title: "变动后余额", dataIndex: "balanceAfter" },
                    { title: "关联", render: (_, r) => (r.refType ? `${r.refType}:${r.refId}` : "-") },
                ]}
            />
        </Drawer>
    );
};

export const UserList = () => {
    const { tableProps, searchFormProps, tableQuery } = useAdminTable<UserRow>("user");
    const act = useAction();
    const [adjusting, setAdjusting] = useState<UserRow | null>(null);
    const [ledgerOf, setLedgerOf] = useState<UserRow | null>(null);
    const [form] = Form.useForm();

    const submitAdjust = async () => {
        const v = await form.validateFields();
        const done = await act("admin/user/adjust-quota", { userId: adjusting!.id, delta: v.delta, remark: v.remark }, "调整成功", tableQuery.refetch);
        if (done !== undefined) setAdjusting(null);
    };

    return (
        <List>
            <SearchBar formProps={searchFormProps} placeholder="邮箱或昵称" />
            <Table
                {...tableProps}
                rowKey="id"
                columns={[
                    { title: "ID", dataIndex: "id", width: 70 },
                    { title: "邮箱", dataIndex: "email" },
                    { title: "昵称", dataIndex: "nickname" },
                    { title: "可用额度", dataIndex: "quota" },
                    { title: "已用额度", dataIndex: "usedQuota" },
                    {
                        title: "状态",
                        dataIndex: "status",
                        render: (s, r) => (
                            <Space>
                                {s === 1 ? <Tag color="green">正常</Tag> : <Tag color="red">已禁用</Tag>}
                                {r.role >= 100 && <Tag color="gold">管理员</Tag>}
                            </Space>
                        ),
                    },
                    { title: "注册时间", dataIndex: "createdAt", render: time },
                    {
                        title: "操作",
                        render: (_, r) => (
                            <Space>
                                <Button size="small" onClick={() => { form.resetFields(); setAdjusting(r); }}>
                                    调额
                                </Button>
                                <Button size="small" onClick={() => setLedgerOf(r)}>
                                    流水
                                </Button>
                                <Popconfirm
                                    title={r.status === 1 ? "禁用后该用户的所有登录会立即失效，确定吗？" : "确定启用该用户？"}
                                    onConfirm={() => act("admin/user/set-status", { userId: r.id, status: r.status === 1 ? 0 : 1 }, "已更新", tableQuery.refetch)}
                                >
                                    <Button size="small" danger={r.status === 1}>
                                        {r.status === 1 ? "禁用" : "启用"}
                                    </Button>
                                </Popconfirm>
                            </Space>
                        ),
                    },
                ]}
            />
            <Modal title={`调整额度 · ${adjusting?.email ?? ""}`} open={!!adjusting} onOk={submitAdjust} onCancel={() => setAdjusting(null)} destroyOnClose>
                <Form form={form} layout="vertical">
                    <Form.Item name="delta" label="调整值（正数增加，负数扣减）" rules={[{ required: true }, { validator: (_, v) => (v ? Promise.resolve() : Promise.reject(new Error("不能为 0"))) }]}>
                        <InputNumber precision={0} style={{ width: "100%" }} />
                    </Form.Item>
                    <Form.Item name="remark" label="备注（写入审计日志）" rules={[{ required: true, message: "请填写调额原因" }]}>
                        <Input maxLength={100} />
                    </Form.Item>
                </Form>
            </Modal>
            <Ledger user={ledgerOf} onClose={() => setLedgerOf(null)} />
        </List>
    );
};
