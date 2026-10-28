import { List } from "@refinedev/antd";
import { Button, Popconfirm, Table, Tag } from "antd";
import { ORDER_STATUS, time, yuan } from "../format";
import { SearchBar, useAction, useAdminTable } from "./common";

export const OrderList = () => {
    const { tableProps, searchFormProps, tableQuery } = useAdminTable("order");
    const act = useAction();
    return (
        <List>
            <SearchBar
                formProps={searchFormProps}
                placeholder="订单号或用户邮箱"
                statusOptions={Object.entries(ORDER_STATUS).map(([value, s]) => ({ value, label: s.text }))}
            />
            <Table
                {...tableProps}
                rowKey="id"
                columns={[
                    { title: "订单号", dataIndex: "tradeNo" },
                    { title: "用户", dataIndex: "email" },
                    { title: "类型", dataIndex: "kind", render: (k, r) => (k === "topup" ? `充值 ${r.quota} 额度` : `套餐 #${r.planId}`) },
                    { title: "金额", dataIndex: "moneyCents", render: yuan },
                    { title: "通道", render: (_, r) => `${r.provider}/${r.method}` },
                    { title: "状态", dataIndex: "status", render: (s) => <Tag color={ORDER_STATUS[s]?.color}>{ORDER_STATUS[s]?.text ?? s}</Tag> },
                    { title: "创建时间", dataIndex: "createdAt", render: time },
                    { title: "支付时间", dataIndex: "paidAt", render: time },
                    {
                        title: "操作",
                        render: (_, r) =>
                            r.status === "pending" && (
                                <Popconfirm
                                    title="请先在支付平台确认已收到款项。补单后将为用户入账或开通套餐，确定吗？"
                                    onConfirm={() => act("admin/order/complete", { tradeNo: r.tradeNo }, "已补单", tableQuery.refetch)}
                                >
                                    <Button size="small">人工补单</Button>
                                </Popconfirm>
                            ),
                    },
                ]}
            />
        </List>
    );
};
