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

console.log("✅ BOT VERSION: Evidenta Actiuni v2");

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
const ACTIONS_CHANNEL_ID = mustEnv("ACTIONS_CHANNEL_ID");

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

function formatUserLine(member) {
  return `<@${member.user.id}>`;
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

  const content =
`**\`${state.createdByName}\`:**
**Se organizează acțiune de tip:** ${state.titlu}

**Detalii despre acțiune:**
**Locație:** ${state.locatie}
**Data/Ora:** ${state.dataOra}
**Frecvență:** \`${state.freq1}\`
**Back-up:** \`${state.freq2}\`

**Mențiuni acțiune:**
${mentiuniText}

**Total membri:** ${state.total}
**Confirmați:** ${prezenti.length}
**Absenți:** ${absenti.length}

✅ **Prezenți**
${prezentiText}

❌ **Absenți**
${absentiText}

Apasă pe ✅ pentru a confirma prezența.`;

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`actiune_confirm_${state.id}`)
      .setLabel("Confirmă prezența")
      .setStyle(ButtonStyle.Success)
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
          .setName("rol")
          .setDescription("Rolul vizat pentru această acțiune")
          .setRequired(true)
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

      const titlu = interaction.options.getString("titlu", true);
      const dataOra = interaction.options.getString("data_ora", true);
      const locatie = interaction.options.getString("locatie", true);
      const role = interaction.options.getRole("rol", true);
      const mentiuni = interaction.options.getString("mentiuni") || "";

      await interaction.guild.members.fetch();

      const membersWithRole = interaction.guild.members.cache
        .filter((member) => !member.user.bot && member.roles.cache.has(role.id))
        .map((member) => member);

      if (membersWithRole.length === 0) {
        return interaction.reply({
          content: "❌ Nu există membri cu rolul selectat.",
          ephemeral: true,
        });
      }

      const [freq1, freq2] = makeTwoDifferentFrequencies();
      const createdByName =
        interaction.member?.nickname ||
        interaction.user.globalName ||
        interaction.user.username;

      const absenti = membersWithRole.map(formatUserLine);

      const tempState = {
        id: "temp",
        titlu,
        dataOra,
        locatie,
        mentiuni,
        roleId: role.id,
        createdById: interaction.user.id,
        createdByName,
        freq1,
        freq2,
        total: membersWithRole.length,
        prezenti: [],
        absenti,
        closed: false,
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

        const userLine = `<@${interaction.user.id}>`;

        const isTargeted =
          state.absenti.includes(userLine) ||
          state.prezenti.includes(userLine);

        if (!isTargeted) {
          return interaction.reply({
            content: "❌ Nu faci parte din rolul selectat pentru această acțiune.",
            ephemeral: true,
          });
        }

        state.absenti = state.absenti.filter((x) => x !== userLine);
        state.prezenti = state.prezenti.filter((x) => x !== userLine);
        state.prezenti.push(userLine);

        const msg = await interaction.channel.messages.fetch(actionId).catch(() => null);
        if (msg) {
          await msg.edit(buildActionMessage(state));
        }

        return interaction.reply({
          content: "✅ Ți-ai confirmat prezența.",
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

        state.closed = true;

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
