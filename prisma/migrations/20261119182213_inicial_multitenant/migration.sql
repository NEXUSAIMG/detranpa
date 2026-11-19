-- CreateTable
CREATE TABLE `Tenant` (
    `id` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(20) NOT NULL,
    `uf` CHAR(2) NOT NULL,
    `sigla` VARCHAR(40) NOT NULL,
    `nome` VARCHAR(160) NOT NULL,
    `governo` VARCHAR(160) NOT NULL,
    `cidadeSede` VARCHAR(80) NOT NULL,
    `assistente` VARCHAR(80) NOT NULL,
    `portalUrl` VARCHAR(255) NOT NULL,
    `telefone` VARCHAR(40) NOT NULL,
    `logoUrl` VARCHAR(255) NULL,
    `marcaUrl` VARCHAR(255) NULL,
    `corPrimaria` VARCHAR(9) NULL,
    `personaTom` TEXT NULL,
    `orientacoes` TEXT NULL,
    `conteudo` JSON NULL,
    `ativo` BOOLEAN NOT NULL DEFAULT true,
    `criadoEm` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `atualizadoEm` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Tenant_slug_key`(`slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TenantIntegracao` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `botayioUrl` VARCHAR(255) NULL,
    `botayioSecretEnc` TEXT NULL,
    `botayioTutorUrlEnc` TEXT NULL,
    `zapayioBaseUrl` VARCHAR(255) NULL,
    `zapayioInstanceId` VARCHAR(120) NULL,
    `zapayioTokenEnc` TEXT NULL,
    `zapayioClientEnc` TEXT NULL,
    `zapayioWebhookEnc` TEXT NULL,
    `atualizadoEm` DATETIME(3) NOT NULL,

    UNIQUE INDEX `TenantIntegracao_tenantId_key`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Usuario` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NULL,
    `nome` VARCHAR(120) NOT NULL,
    `login` VARCHAR(120) NOT NULL,
    `senhaHash` VARCHAR(255) NOT NULL,
    `perfil` ENUM('SUPERADMIN', 'ADMIN', 'GESTOR', 'TUTOR', 'BALCAO') NOT NULL,
    `ativo` BOOLEAN NOT NULL DEFAULT true,
    `ultimoAcesso` DATETIME(3) NULL,
    `criadoEm` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Usuario_login_idx`(`login`),
    UNIQUE INDEX `Usuario_tenantId_login_key`(`tenantId`, `login`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Formulario` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `chave` VARCHAR(60) NOT NULL,
    `ordem` INTEGER NOT NULL DEFAULT 0,
    `definicao` JSON NOT NULL,
    `ativo` BOOLEAN NOT NULL DEFAULT true,

    UNIQUE INDEX `Formulario_tenantId_chave_key`(`tenantId`, `chave`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Evento` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `tipo` VARCHAR(20) NOT NULL,
    `canal` ENUM('WEB', 'WHATSAPP') NOT NULL DEFAULT 'WEB',
    `tema` VARCHAR(60) NULL,
    `resolvido` BOOLEAN NULL,
    `positivo` BOOLEAN NULL,
    `transbordo` BOOLEAN NOT NULL DEFAULT false,
    `criadoEm` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Evento_tenantId_criadoEm_idx`(`tenantId`, `criadoEm`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AtendimentoBalcao` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `usuarioId` VARCHAR(191) NULL,
    `guiche` VARCHAR(40) NULL,
    `atendente` VARCHAR(60) NULL,
    `servico` VARCHAR(120) NULL,
    `cidadao` VARCHAR(80) NULL,
    `cpf` VARCHAR(20) NULL,
    `protocolo` VARCHAR(40) NULL,
    `resumo` TEXT NULL,
    `criadoEm` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AtendimentoBalcao_tenantId_criadoEm_idx`(`tenantId`, `criadoEm`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Conversa` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `canal` ENUM('WEB', 'WHATSAPP') NOT NULL,
    `contato` VARCHAR(80) NOT NULL,
    `nome` VARCHAR(120) NULL,
    `status` VARCHAR(12) NOT NULL DEFAULT 'BOT',
    `categoria` VARCHAR(60) NULL,
    `iniciadaEm` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `ultimaEm` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Conversa_tenantId_ultimaEm_idx`(`tenantId`, `ultimaEm`),
    UNIQUE INDEX `Conversa_tenantId_canal_contato_key`(`tenantId`, `canal`, `contato`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Mensagem` (
    `id` VARCHAR(191) NOT NULL,
    `conversaId` VARCHAR(191) NOT NULL,
    `autor` VARCHAR(12) NOT NULL,
    `texto` TEXT NOT NULL,
    `criadoEm` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Mensagem_conversaId_criadoEm_idx`(`conversaId`, `criadoEm`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `TenantIntegracao` ADD CONSTRAINT `TenantIntegracao_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Usuario` ADD CONSTRAINT `Usuario_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Formulario` ADD CONSTRAINT `Formulario_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Evento` ADD CONSTRAINT `Evento_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AtendimentoBalcao` ADD CONSTRAINT `AtendimentoBalcao_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Conversa` ADD CONSTRAINT `Conversa_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Mensagem` ADD CONSTRAINT `Mensagem_conversaId_fkey` FOREIGN KEY (`conversaId`) REFERENCES `Conversa`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
