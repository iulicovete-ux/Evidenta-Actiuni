require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Events,
} = require("discord.js");

console.log("✅ BOT VERSION: Evidenta Actiuni v7");

function mustEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`❌ Missing environment variable: ${name}`);
    process.exit(1);
  }
  return v;
}

const TOKEN = mustEnv("TOKEN");
const CLIENT_ID = mustEnv("CLIENT_ID");
const GUILD_ID = mustEnv("GUILD_ID");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.GuildMember],
});

// actionMessageId -> state
const actions = new Map();

function makeFrequency() {
  const a = Math.floor(Math.random() * 900) + 100;
  const b = Math.floor(Math.random() * 900) + 100;
  return `${a}.${b}`;
}

function makeTwoDifferentFrequencies() {
  const f1 = makeFrequency();
  let f2 = makeFrequency();
  while (f2 === f1) {
    f2 = makeFrequency();
  }
  return [f1, f2];
}

function formatAbsentUser(member) {
  return `<@${member.user.id}>`;
}

function formatPresentUserOpen(userId, startUnix) {
  return `<@${userId}> — <t:${startUnix}:t>`;
}

function formatPresentUserClosed(userId, startUnix, endUnix) {
  return `<@${userId}> — <t:${startUnix}:t> → <t:${endUnix}:t>`;
}

function uniqueSorted(arr) {
  return Array.from(new Set(arr)).sort((a, b) => a.localeCompare(b, "ro"));
}

function buildActionMessage(state) {
  const prezenti = uniqueSorted(state.prezenti);
  const absenti = uniqueSorted(state.absenti);

  const prezentiText = prezenti.length > 0 ? prezenti.join("\n") : "-";
  const absentiText = absenti.length > 0 ? absenti.join("\n") : "-";
  const mentiuniText = state.mentiuni?.trim() ? state.mentiuni.trim() : "-";

  const closedText = state.closedAt
    ? `\n**Acțiunea s-a închis la:** <t:${state.closedAt}:f>\n`
    : "";

  const content =
`**\`${state.createdByName}\`:**
**Se organizează acțiune de tip:** ${state.titlu}

**Detalii despre acțiune:**
**Locație:** ${state.locatie}
**Data/Ora:** ${state.dataOra}
**Frecvență:** \`${state.freq1}\`
**Back-up:** \`${state.freq2}\`

**Mențiuni acțiune:**
${mentiuniText}${closedText}
**Total membri:** ${state.total}
**Confirmați:** ${prezenti.length}
**Absenți:** ${absenti.length}

✅ **Prezenți**
${prezentiText}

❌ **Absenți**
${absentiText}

Apasă pe ✅ pentru a confirma prezența. Dacă pleci mai devreme, apasă pe „Părăsește acțiunea”.`;

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`actiune_confirm_${state.id}`)
      .setLabel("Confirmă prezența")
      .setStyle(ButtonStyle.Success)
      .setDisabled(state.closed),
    new ButtonBuilder()
      .setCustomId(`actiune_leave_${state.id}`)
      .setLabel("Părăsește acțiunea")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(state.closed),
    new ButtonBuilder()
      .setCustomId(`actiune_close_${state.id}`)
      .setLabel("Închide acțiunea")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(state.closed)
  );

  return { content, components: [buttons] };
}

async function registerCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName("actiune")
      .setDescription("Creează o nouă evidență de acțiune.")
      .addStringOption((option) =>
        option
          .setName("titlu")
          .setDescription("Tipul acțiunii (patrula/farm/jaf/etc...)")
          .setRequired(true)
      )
      .addStringOption((option) =>
        option
          .setName("data_ora")
          .setDescription("Data și ora într-un singur câmp")
          .setRequired(true)
      )
      .addStringOption((option) =>
        option
          .setName("locatie")
          .setDescription("Locația acțiunii")
          .setRequired(true)
      )
      .addRoleOption((option) =>
        option
          .setName("rol1")
          .setDescription("Primul rol participant")
          .setRequired(true)
      )
      .addRoleOption((option) =>
        option
          .setName("rol2")
          .setDescription("Al doilea rol participant (opțional)")
          .setRequired(false)
      )
      .addRoleOption((option) =>
        option
          .setName("rol3")
          .setDescription("Al treilea rol participant (opțional)")
          .setRequired(false)
      )
      .addStringOption((option) =>
        option
          .setName("mentiuni")
          .setDescription("Detalii suplimentare: ce să aducă, unde se regrupează etc.")
          .setRequired(false)
      )
      .toJSON(),
  ];

  const rest = new REST({ version: "10" }).setToken(TOKEN);

  await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    { body: commands }
  );

  console.log("✅ Slash commands registered.");
}

client.once(Events.ClientReady, async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  await registerCommands();
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand() && interaction.commandName === "actiune") {
      const actionsChannel = interaction.channel;

      if (!actionsChannel || !actionsChannel.isTextBased()) {
        return interaction.reply({
          content: "❌ Acest canal nu este valid pentru această comandă.",
          ephemeral: true,
        });
      }

      const titlu = interaction.options.getString("titlu", true);
      const dataOra = interaction.options.getString("data_ora", true);
      const locatie = interaction.options.getString("locatie", true);
      const rol1 = interaction.options.getRole("rol1", true);
      const rol2 = interaction.options.getRole("rol2");
      const rol3 = interaction.options.getRole("rol3");
      const mentiuni = interaction.options.getString("mentiuni") || "";

      await interaction.guild.members.fetch();

      const selectedRoleIds = [rol1, rol2, rol3]
        .filter(Boolean)
        .map((role) => role.id);

      const uniqueMembersMap = new Map();

      interaction.guild.members.cache.forEach((member) => {
        if (member.user.bot) return;

        const hasAnySelectedRole = selectedRoleIds.some((roleId) =>
          member.roles.cache.has(roleId)
        );

        if (hasAnySelectedRole) {
          uniqueMembersMap.set(member.user.id, member);
        }
      });

      const membersWithRoles = Array.from(uniqueMembersMap.values());

      if (membersWithRoles.length === 0) {
        return interaction.reply({
          content: "❌ Nu există membri cu rolurile selectate.",
          ephemeral: true,
        });
      }

      const [freq1, freq2] = makeTwoDifferentFrequencies();
      const createdByName =
        interaction.member?.nickname ||
        interaction.user.globalName ||
        interaction.user.username;

      const absenti = membersWithRoles.map(formatAbsentUser);

      const tempState = {
        id: "temp",
        titlu,
        dataOra,
        locatie,
        mentiuni,
        roleIds: selectedRoleIds,
        createdById: interaction.user.id,
        createdByName,
        freq1,
        freq2,
        total: membersWithRoles.length,
        prezenti: [],
        absenti,
        closed: false,
        closedAt: null,
      };

      const sent = await actionsChannel.send(buildActionMessage(tempState));

      tempState.id = sent.id;
      actions.set(sent.id, tempState);

      await sent.edit(buildActionMessage(tempState));

      return interaction.reply({
        content: "✅ Acțiunea a fost creată în acest canal.",
        ephemeral: true,
      });
    }

    if (interaction.isButton()) {
      if (interaction.customId.startsWith("actiune_confirm_")) {
        const actionId = interaction.customId.replace("actiune_confirm_", "");
        const state = actions.get(actionId);

        if (!state) {
          return interaction.reply({
            content: "❌ Acțiunea nu mai există în memorie. Repornește una nouă.",
            ephemeral: true,
          });
        }

        if (state.closed) {
          return interaction.reply({
            content: "❌ Acțiunea este închisă.",
            ephemeral: true,
          });
        }

        const absentLine = `<@${interaction.user.id}>`;
        const presentPrefix = `<@${interaction.user.id}> —`;

        const isTargeted =
          state.absenti.includes(absentLine) ||
          state.prezenti.some((x) => x.startsWith(presentPrefix));

        if (!isTargeted) {
          return interaction.reply({
            content: "❌ Nu faci parte din participanții selectați pentru această acțiune.",
            ephemeral: true,
          });
        }

        // If already present, don't overwrite the original confirm timestamp
        if (state.prezenti.some((x) => x.startsWith(presentPrefix))) {
          return interaction.reply({
            content: "❌ Ți-ai confirmat deja prezența.",
            ephemeral: true,
          });
        }

        const unixSeconds = Math.floor(Date.now() / 1000);
        const presentLine = formatPresentUserOpen(interaction.user.id, unixSeconds);

        state.absenti = state.absenti.filter((x) => x !== absentLine);
        state.prezenti.push(presentLine);

        const msg = await interaction.channel.messages.fetch(actionId).catch(() => null);
        if (msg) {
          await msg.edit(buildActionMessage(state));
        }

        return interaction.reply({
          content: "✅ Ți-ai confirmat prezența.",
          ephemeral: true,
        });
      }

      if (interaction.customId.startsWith("actiune_leave_")) {
        const actionId = interaction.customId.replace("actiune_leave_", "");
        const state = actions.get(actionId);

        if (!state) {
          return interaction.reply({
            content: "❌ Acțiunea nu mai există în memorie.",
            ephemeral: true,
          });
        }

        if (state.closed) {
          return interaction.reply({
            content: "❌ Acțiunea este deja închisă.",
            ephemeral: true,
          });
        }

        const userPrefix = `<@${interaction.user.id}> —`;
        const currentEntry = state.prezenti.find((x) => x.startsWith(userPrefix));

        if (!currentEntry) {
          return interaction.reply({
            content: "❌ Nu poți părăsi acțiunea dacă nu ți-ai confirmat prezența.",
            ephemeral: true,
          });
        }

        // If already has a leaving timestamp, don't overwrite it
        if (currentEntry.includes("→")) {
          return interaction.reply({
            content: "❌ Ai înregistrat deja ieșirea din acțiune.",
            ephemeral: true,
          });
        }

        const match = currentEntry.match(/^<@(\d+)> — <t:(\d+):t>$/);
        if (!match) {
          return interaction.reply({
            content: "❌ Nu am putut procesa ora ta de intrare.",
            ephemeral: true,
          });
        }

        const userId = match[1];
        const startUnix = Number(match[2]);
        const leaveUnix = Math.floor(Date.now() / 1000);

        const updatedEntry = formatPresentUserClosed(userId, startUnix, leaveUnix);

        state.prezenti = state.prezenti.map((x) =>
          x === currentEntry ? updatedEntry : x
        );

        const msg = await interaction.channel.messages.fetch(actionId).catch(() => null);
        if (msg) {
          await msg.edit(buildActionMessage(state));
        }

        return interaction.reply({
          content: "✅ Ai părăsit acțiunea. Ora ieșirii a fost înregistrată.",
          ephemeral: true,
        });
      }

      if (interaction.customId.startsWith("actiune_close_")) {
        const actionId = interaction.customId.replace("actiune_close_", "");
        const state = actions.get(actionId);

        if (!state) {
          return interaction.reply({
            content: "❌ Acțiunea nu mai există în memorie.",
            ephemeral: true,
          });
        }

        if (interaction.user.id !== state.createdById) {
          return interaction.reply({
            content: "❌ Doar persoana care a creat acțiunea o poate închide.",
            ephemeral: true,
          });
        }

        const closeUnix = Math.floor(Date.now() / 1000);
        state.closed = true;
        state.closedAt = closeUnix;

        // Add closing timestamp only to members who are still "open"
        state.prezenti = state.prezenti.map((entry) => {
          if (entry.includes("→")) return entry;

          const match = entry.match(/^<@(\d+)> — <t:(\d+):t>$/);
          if (!match) return entry;

          const userId = match[1];
          const startUnix = Number(match[2]);

          return formatPresentUserClosed(userId, startUnix, closeUnix);
        });

        const msg = await interaction.channel.messages.fetch(actionId).catch(() => null);
        if (msg) {
          await msg.edit(buildActionMessage(state));
        }

        return interaction.reply({
          content: "✅ Acțiunea a fost închisă.",
          ephemeral: true,
        });
      }
    }
  } catch (err) {
    console.error("❌ Interaction error:", err);
    try {
      if (interaction.isRepliable()) {
        await interaction.reply({
          content: "❌ A apărut o eroare.",
          ephemeral: true,
        });
      }
    } catch {}
  }
});

client.login(TOKEN);
