import discord
from discord import app_commands
from discord.ext import commands
import logging
import time

logger = logging.getLogger('WavelyBot.Utility')

class Utility(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    # 1. PING
    @app_commands.command(name="ping", description="Check the bot's latency and response time.")
    async def ping(self, interaction: discord.Interaction):
        latency = round(self.bot.latency * 1000) # milliseconds
        
        # Calculate API response speed
        start_time = time.time()
        await interaction.response.send_message("Calculating latency...", ephemeral=True)
        end_time = time.time()
        api_latency = round((end_time - start_time) * 1000)

        embed = discord.Embed(
            title="🏓 Pong!",
            color=discord.Color.from_str("#7a22ff")
        )
        embed.add_field(name="Gateway Latency", value=f"📡 `{latency}ms`", inline=True)
        embed.add_field(name="API Latency", value=f"⚡ `{api_latency}ms`", inline=True)
        
        await interaction.edit_original_response(content=None, embed=embed)

    # 2. AVATAR
    @app_commands.command(name="avatar", description="Get a member's avatar in high resolution.")
    @app_commands.describe(member="Member to fetch avatar for (defaults to yourself)")
    async def avatar(self, interaction: discord.Interaction, member: discord.Member = None):
        target = member or interaction.user
        
        avatar_url = target.display_avatar.url
        
        embed = discord.Embed(
            title=f"🖼️ Avatar - {target.display_name}",
            color=discord.Color.from_str("#7a22ff")
        )
        embed.set_image(url=avatar_url)
        
        # Button link to download/view high res
        view = discord.ui.View()
        view.add_item(discord.ui.Button(
            label="Open Image in Browser", 
            style=discord.ButtonStyle.link, 
            url=avatar_url
        ))
        
        await interaction.response.send_message(embed=embed, view=view)

    # 3. USER INFO
    @app_commands.command(name="userinfo", description="Get details about a server member.")
    @app_commands.describe(member="Member to lookup (defaults to yourself)")
    async def userinfo(self, interaction: discord.Interaction, member: discord.Member = None):
        target = member or interaction.user
        
        # Format roles list (excluding @everyone)
        roles = [role.mention for role in target.roles if role != interaction.guild.default_role]
        roles_str = ", ".join(roles) if roles else "No additional roles"
        
        # Format dates
        joined_at = target.joined_at.strftime('%Y-%m-%d %H:%M:%S UTC') if target.joined_at else "Unknown"
        created_at = target.created_at.strftime('%Y-%m-%d %H:%M:%S UTC')
        
        embed = discord.Embed(
            title=f"👤 User Information - {target.name}",
            color=discord.Color.from_str("#7a22ff")
        )
        if target.avatar:
            embed.set_thumbnail(url=target.avatar.url)
            
        embed.add_field(name="Mention", value=target.mention, inline=True)
        embed.add_field(name="ID", value=f"`{target.id}`", inline=True)
        embed.add_field(name="Top Role", value=target.top_role.mention if target.top_role else "None", inline=True)
        embed.add_field(name="Created Account", value=f"🗓️ {created_at}", inline=False)
        embed.add_field(name="Joined Server", value=f"📥 {joined_at}", inline=False)
        embed.add_field(name=f"Roles ({len(roles)})", value=roles_str, inline=False)
        
        await interaction.response.send_message(embed=embed)

    # 4. SERVER INFO
    @app_commands.command(name="serverinfo", description="Get server specifications and statistics.")
    async def serverinfo(self, interaction: discord.Interaction):
        guild = interaction.guild
        
        # General stats
        member_count = guild.member_count
        bot_count = sum(1 for m in guild.members if m.bot)
        human_count = member_count - bot_count
        
        channels_count = len(guild.channels)
        roles_count = len(guild.roles)
        emojis_count = len(guild.emojis)
        
        created_at = guild.created_at.strftime('%Y-%m-%d %H:%M:%S UTC')
        owner = guild.owner or await guild.fetch_member(guild.owner_id)
        owner_str = f"{owner.name} ({owner.id})" if owner else f"Owner ID: {guild.owner_id}"
        
        # Boost status
        boost_tier = guild.premium_tier
        boost_count = guild.premium_subscription_count

        embed = discord.Embed(
            title=f"🏰 Server Diagnostics - {guild.name}",
            color=discord.Color.from_str("#7a22ff")
        )
        
        if guild.icon:
            embed.set_thumbnail(url=guild.icon.url)
            
        if guild.banner:
            embed.set_image(url=guild.banner.url)

        embed.add_field(name="Owner", value=f"👑 {owner_str}", inline=True)
        embed.add_field(name="Server ID", value=f"`{guild.id}`", inline=True)
        embed.add_field(name="Created Date", value=f"🗓️ {created_at}", inline=False)
        
        embed.add_field(
            name="Members", 
            value=f"👥 Total: **{member_count:,}**\n👤 Humans: **{human_count:,}**\n🤖 Bots: **{bot_count:,}**", 
            inline=True
        )
        embed.add_field(
            name="Assets", 
            value=f"💬 Channels: **{channels_count}**\n🛡️ Roles: **{roles_count}**\n😀 Emojis: **{emojis_count}**", 
            inline=True
        )
        embed.add_field(
            name="Boost Status", 
            value=f"✨ Tier: **{boost_tier}**\n🚀 Boosts: **{boost_count}**", 
            inline=True
        )
        
        embed.set_footer(text=f"Verification Level: {guild.verification_level.name}")
        await interaction.response.send_message(embed=embed)

    # 5. HELP
    @app_commands.command(name="help", description="List all available bot commands on Wavely.")
    async def help(self, interaction: discord.Interaction):
        embed = discord.Embed(
            title="📚 Wavely Bot Command Index",
            description="Here is a list of all available slash commands categorized by module.",
            color=discord.Color.from_str("#7a22ff")
        )
        
        # Categories
        embed.add_field(
            name="📥 Verification Gate",
            value=(
                "`/verify_setup` - Deploys the verification banner message with role button. (Admin-only)\n"
                "*Assigns the download access role.*"
            ),
            inline=False
        )
        
        embed.add_field(
            name="🎫 Ticket System",
            value=(
                "`/ticket_setup` - Deploys the support ticket opening panel. (Admin/Staff only)\n"
                "`/ticket_open` - Open a private support ticket.\n"
                "`/ticket_add <member>` - Add a user to an active ticket channel. (Staff only)\n"
                "`/ticket_remove <member>` - Remove a user from a ticket channel. (Staff only)\n"
                "`/ticket_delete` - Permanently delete a closed ticket channel. (Staff only)"
            ),
            inline=False
        )

        embed.add_field(
            name="🛡️ Server Security / Anti-Raid",
            value=(
                "`/antiraid status` - Checks current invite configurations and shield state. (Mod-only)\n"
                "`/antiraid toggle <True/False>` - Manually enable/disable the invite-lock shield. (Mod-only)"
            ),
            inline=False
        )

        embed.add_field(
            name="⭐ Leveling & Engagement",
            value=(
                "`/rank [member]` - View current level, XP, and global leaderboard rank.\n"
                "`/leaderboard` - Show the top 10 most active members on the server.\n"
                "`/level set <member> <level> [xp]` - Force overwrite a member's level metrics. (Mod-only)\n"
                "`/level add_xp <member> <amount>` - Award direct XP to a member. (Mod-only)\n"
                "`/level reset <member>` - Reset a member's XP and Level metrics to zero. (Mod-only)"
            ),
            inline=False
        )

        embed.add_field(
            name="🔨 Moderation Suite (Mod-only)",
            value=(
                "`/kick <member> [reason]` - Kick a member from the guild.\n"
                "`/ban <member> [reason] [delete_days]` - Ban a member permanently.\n"
                "`/unban <user_id> [reason]` - Revoke a ban by user ID.\n"
                "`/timeout <member> <minutes> [reason]` - Place a member in time-out (mute).\n"
                "`/warn <member> <reason>` - Record a rule warning for a user.\n"
                "`/warnings <member>` - View active warnings count and logs for a user.\n"
                "`/clearwarnings <member>` - Delete all warning logs for a user.\n"
                "`/purge <amount>` - Delete up to 100 messages in this channel."
            ),
            inline=False
        )

        embed.add_field(
            name="🛠️ General Utility",
            value=(
                "`/ping` - Test gateway connectivity and speed.\n"
                "`/avatar [member]` - Get high-resolution link to user avatars.\n"
                "`/userinfo [member]` - Get profile diagnostics for a member.\n"
                "`/serverinfo` - Check server specifications and boost progress."
            ),
            inline=False
        )

        embed.set_footer(text="Wavely Official Discord Bot • Code: w!")
        await interaction.response.send_message(embed=embed)

async def setup(bot):
    await bot.add_cog(Utility(bot))
