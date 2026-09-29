ALTER TABLE "Income" ADD COLUMN "paymentId" TEXT;
CREATE UNIQUE INDEX "Income_paymentId_key" ON "Income"("paymentId");
ALTER TABLE "Income" ADD CONSTRAINT "Income_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
