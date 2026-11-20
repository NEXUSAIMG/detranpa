-- Lembretes pelo WhatsApp (CNH, defesa, licenciamento), com consentimento.
-- Nomes de tabela com maiúscula: o MySQL do Railway (Linux) diferencia.
-- CreateTable
CREATE TABLE `Lembrete` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `contato` VARCHAR(20) NOT NULL,
    `tipo` VARCHAR(20) NOT NULL,
    `dataAlvo` DATETIME(3) NOT NULL,
    `descricao` VARCHAR(160) NULL,
    `avisos` JSON NOT NULL,
    `enviados` JSON NULL,
    `status` VARCHAR(12) NOT NULL DEFAULT 'PENDENTE',
    `origem` VARCHAR(12) NOT NULL,
    `consentidoEm` DATETIME(3) NULL,
    `ultimoEnvioEm` DATETIME(3) NULL,
    `criadoEm` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Lembrete_tenantId_status_dataAlvo_idx`(`tenantId`, `status`, `dataAlvo`),
    INDEX `Lembrete_tenantId_contato_idx`(`tenantId`, `contato`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Lembrete` ADD CONSTRAINT `Lembrete_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
