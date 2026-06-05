"use client";

import { motion } from "framer-motion";
import { Card, CardBody, Skeleton } from "@heroui/react";
import { staggerContainer, staggerItem } from "@/lib/motion";

export default function LoadingShowcasePage() {
  return (
    <motion.div
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
      className="space-y-8"
    >
      <motion.div variants={staggerItem}>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Loading States</h1>
        <p className="mt-1 text-sm text-default-500">Skeleton patterns used throughout the app</p>
      </motion.div>

      {/* KPI cards skeleton */}
      <motion.div variants={staggerItem} className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="rounded-xl shadow-small">
            <CardBody className="gap-3 p-4">
              <Skeleton className="h-4 w-24 rounded-lg" />
              <Skeleton className="h-8 w-16 rounded-lg" />
              <Skeleton className="h-3 w-20 rounded-lg" />
            </CardBody>
          </Card>
        ))}
      </motion.div>

      {/* Table skeleton */}
      <motion.div variants={staggerItem}>
        <Card className="rounded-xl shadow-small">
          <CardBody className="gap-3 p-4">
            <div className="flex items-center gap-3 border-b border-default-100 pb-3 dark:border-white/5">
              <Skeleton className="h-4 w-[40%] rounded-lg" />
              <Skeleton className="h-4 w-[20%] rounded-lg" />
              <Skeleton className="h-4 w-[20%] rounded-lg" />
              <Skeleton className="h-4 w-[20%] rounded-lg" />
            </div>
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
                <Skeleton className="h-4 w-[35%] rounded-lg" />
                <Skeleton className="h-4 w-[20%] rounded-lg" />
                <Skeleton className="h-4 w-[20%] rounded-lg" />
                <Skeleton className="ml-auto h-6 w-16 rounded-full" />
              </div>
            ))}
          </CardBody>
        </Card>
      </motion.div>

      {/* Text skeleton */}
      <motion.div variants={staggerItem} className="space-y-2">
        {[90, 75, 85, 60].map((w, i) => (
          <Skeleton key={i} style={{ width: `${w}%` }} className="h-4 rounded-lg" />
        ))}
      </motion.div>
    </motion.div>
  );
}
