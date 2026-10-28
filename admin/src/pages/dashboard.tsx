import { useEffect, useState } from "react";
import { Card, Col, Row, Statistic, Table, Typography } from "antd";
import { api } from "../api";
import { yuan } from "../format";

type Stats = {
    users: number;
    usersToday: number;
    revenueTodayCents: number;
    tasksToday: number;
    tasksFailedToday: number;
    quotaUsedToday: number;
    revenue7d: { day: string; cents: number; orders: number }[];
};

export const DashboardPage = () => {
    const [stats, setStats] = useState<Stats | null>(null);
    useEffect(() => {
        api<Stats>("admin/stats").then(setStats).catch(() => setStats(null));
    }, []);
    const items: [string, number | string][] = stats
        ? [
              ["用户总数", stats.users],
              ["今日新增用户", stats.usersToday],
              ["今日收入", yuan(stats.revenueTodayCents)],
              ["今日云端任务", stats.tasksToday],
              ["今日失败任务", stats.tasksFailedToday],
              ["今日消耗额度", stats.quotaUsedToday],
          ]
        : [];
    return (
        <div>
            <Typography.Title level={4}>概览</Typography.Title>
            <Row gutter={[16, 16]}>
                {items.map(([title, value]) => (
                    <Col key={title} xs={12} md={8} xl={4}>
                        <Card>
                            <Statistic title={title} value={value} />
                        </Card>
                    </Col>
                ))}
            </Row>
            <Card title="近 7 天收入" style={{ marginTop: 16 }}>
                <Table
                    rowKey="day"
                    pagination={false}
                    dataSource={stats?.revenue7d ?? []}
                    columns={[
                        { title: "日期", dataIndex: "day" },
                        { title: "订单数", dataIndex: "orders" },
                        { title: "收入", dataIndex: "cents", render: yuan },
                    ]}
                />
            </Card>
        </div>
    );
};
