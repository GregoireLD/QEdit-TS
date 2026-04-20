/**
 * Monaco language definition for PSO quest assembly.
 *
 * Token types mapped to the Classic theme colours from qedit:
 *   labels    → yellow   (#f0c040)
 *   opcodes   → white    (#ffffff)
 *   registers → lime     (#80ff40)
 *   numbers   → fuchsia  (#ff40ff)
 *   strings   → cyan     (#40ffff)
 *   comments  → silver   (#a0a0a0)
 *   directives→ silver   (#a0a0a0)
 */

import type * as Monaco from 'monaco-editor';

// ─── Complete opcode list extracted from Asm.txt ──────────────────────────

export const OPCODES: string[] = [
  'nop','ret','sync','exit','thread','va_start','va_end','va_call',
  'let','leti','letb','letw','leta','leto',
  'set','clear','rev','gset','gclear','grev','glet','gget',
  'add','addi','sub','subi','mul','muli','div','divi',
  'and','andi','or','ori','xor','xori','mod','modi','modi2',
  'jmp','call',
  'jmp_on','jmp_off',
  'jmp_=','jmpi_=','jmp_!=','jmpi_!=',
  'ujmp_>','ujmpi_>','jmp_>','jmpi_>',
  'ujmp_<','ujmpi_<','jmp_<','jmpi_<',
  'ujmp_>=','ujmpi_>=','jmp_>=','jmpi_>=',
  'ujmp_<=','ujmpi_<=','jmp_<=','jmpi_<=',
  'switch_jmp','switch_call',
  'stack_push','stack_pop','stack_pushm','stack_popm',
  'arg_pushr','arg_pushl','arg_pushb','arg_pushw','arg_pusha','arg_pusho','arg_pushs',
  'message','list','fadein','fadeout','sound_effect','bgm',
  'enable','disable','window_msg','add_msg','mesend','gettime','winend',
  'npc_crt_V1','npc_crt_V3','npc_stop','npc_play','npc_kill','npc_nont','npc_talk',
  'npc_crp_V1','npc_crp_V3','create_pipe',
  'p_hpstat_V1','p_hpstat_V3','p_dead_V1','p_dead_V3',
  'p_disablewarp','p_enablewarp','p_move_v1','p_move_V3','p_look',
  'p_action_disable','p_action_enable',
  'disable_movement1','enable_movement1','disable_movement2','enable_movement2',
  'p_noncol','p_col','p_setpos','p_return_guild','p_talk_guild',
  'npc_talk_pl_V1','npc_talk_pl_V3','npc_talk_kill',
  'npc_crtpk_V1','npc_crtpk_V3','npc_crppk_V1','npc_crppk_V3',
  'npc_crptalk_v1','npc_crptalk_V3','npc_crptalk_id_V1','npc_crptalk_id_V3',
  'npc_crp_id_V1','npc_crp_id_v3','npc_text','npc_chkwarp','npc_param_V1','npc_param_V3',
  'npc_lang_clean',
  'p_look_at','pl_pkoff','pl_pkon',
  'pl_walk_V1','pl_walk_V3','pl_add_meseta','pl_add_meseta2','pl_chk_item2',
  'cam_quake','cam_adj','cam_zmin','cam_zmout','cam_pan_V1','cam_pan_V3',
  'game_lev_super','game_lev_reset',
  'pos_pipe_V1','pos_pipe_V3',
  'if_zone_clear','chk_ene_num','unhide_obj','unhide_ene',
  'at_coords_call','at_coords_talk','at_coords_call_ex','at_coords_talk_ex',
  'walk_to_coord_call','walk_to_coord_call_ex','col_npcinr','col_npcinr_ex',
  'switch_on','switch_off','playbgm_epi','set_mainwarp','clear_mainwarp',
  'set_obj_param','set_obj_param_ex','del_obj_param',
  'set_floor_handler','clr_floor_handler',
  'check_npc_straggle','hud_hide','hud_show','cine_enable','cine_disable',
  'broken_list',
  'set_qt_failure','set_qt_success','clr_qt_failure','clr_qt_success',
  'set_qt_cancel','clr_qt_cancel','set_qt_exit','clr_qt_exit',
  'pl_add_meseta','thread_stg',
  'item_create','item_create2','item_delete','item_delete2','item_check',
  'item_check_bank','item_detect_bank','item_packing1','item_packing2',
  'item_select','item_create_cmode','item_create_multi_cm','item_create_unknown',
  'item_delete_slot','open_pack_select',
  'setevt','get_difflvl','get_difflvl2',
  'particle_V1','particle_V3','particle2','particle3','particle3f_id',
  'particle_id_V1','particle_id_V3',
  'map_designate','map_designate_ex','masterkey_on','masterkey_off',
  'window_time','winend_time','winset_time','getmtime',
  'set_quest_board_handler','clear_quest_board_handler',
  'leti_fixed_camera_V1','leti_fixed_camera_V3',
  'fleti_fixed_camera','fleti_locked_camera','default_camera_pos1','default_camera_pos2',
  'read_global_flag','write_global_flag',
  'read_guildcard_flag','write_guild_flagl','write_guild_flagw',
  'read_guildflag_16b','read_guildflag_32b',
  'read1','read2','read4','write1','write2','write4',
  'get_player_status','get_player_hp','get_player_level',
  'get_number_of_player1','get_number_of_player2',
  'get_floor_number','get_game_version','get_gc_number',
  'get_guildcard_num','get_guildcard_total','get_serial_number','get_servernumber',
  'get_slot_meseta','take_slot_meseta','get_slotnumber',
  'get_section_id','get_gender','get_chara_class',
  'get_random','get_time_played','get_total_deaths',
  'get_pad_cond','get_button_cond',
  'get_coord_of_player','get_movement_data','get_physical_data',
  'get_resist_data','get_attack_data','get_npc_data',
  'get_vector_from_path','get_coord_player_detect',
  'get_num_kills','reset_kills',
  'get_item_id','get_item_info','get_stackable_item_count',
  'get_mag_stats','is_mag_hacked',
  'get_paletteX_activated','restore_paletteX',
  'activate_paletteX','disable_paletteX','enable_paletteX',
  'set_paletteX_callback',
  'get_ba_record','get_bosswarp_option',
  'enable_bosswarp_option','disable_bosswarp_option',
  'get_unknown_mode','get_wrap_status',
  'dec2float','float2dec','floati','floatlet',
  'sin','cos','atan','tan',
  'fadd','faddi','fsub','fsubi','fmul','fmuli','fdiv','fdivi',
  'compute_bezier_curve_path',
  'floor_player_detect','player_recovery','players_in_range',
  'go_floor','initial_floor','set_episode','set_episode2',
  'set_floor_handler','clr_floor_handler',
  'load_enemy_data','load_npc_data','load_pvr','file_dl_req','get_dl_status',
  'lock_door2','unlock_door2',
  'freeze_enemies','unfreeze_enemies','freeze_everything','unfreeze_everything',
  'kill_player','restore_hp','restore_tp',
  'set_slot_poison','set_slot_paralyse','set_slot_freeze','set_slot_shock',
  'set_slot_confuse','set_slot_slow','set_slot_jellen','set_slot_zalure',
  'set_slot_deband','set_slot_shifta','set_slot_invincible',
  'add_damage_to','take_damage_score','give_damage_score',
  'death_score','kill_score','enemy_kill_score','enemy_death_score',
  'enemy_give_score','enemy_take_score','meseta_score','award_srank',
  'exp_multiplication','death_lvl_up','death_tech_lvl_up2',
  'sync_register','sync_register2','sync_let','sync_leti',
  'equip_item_v2','equip_item_v3','unequip_item_V2','unequip_item_V3',
  'freeze_and_hide_equip','thaw_and_show_equip',
  'disable_techs','enable_techs','disable_weapon_drop','enable_weapon_drop',
  'disable_stealth_suit_effect','enable_stealth_suit_effect',
  'allow_weapons',
  'shift_left','shift_right',
  'set_returncity','set_returnhunter',
  'enable_mainmenu','disable_retry_menu','retry_menu',
  'chl_death_recap','chl_enable_retry',
  'disable_win_pfx','enable_win_pfx','set_motion_blur',
  'disable_bosswarp_option','enable_bosswarp_option',
  'disable_map','enable_map','reset_map',
  'move_coords_obj','load_midi','create_bgmctrl','enable_bgmctrl',
  'start_battlebgm','end_battlebgm','turn_on_bgm_p2','turn_off_bgm_p2',
  'scroll_text','chat_box','chat_bubble','close_chat_bubble','chat_detect',
  'keyword_detect','symbol_chat_create','symchat_unknown',
  'send_mail','sw_send','set_area_title','set_area_total',
  'clear_area_list','disp_msg_qb','close_msg_qb','congrats_msg_multi_cm',
  'set_score_announce','clear_score_announce','disp_time_cmode',
  'someone_has_spoken',
  'set_cmode_diff','set_cmode_rank','cmode_rank','cmode_stage',
  'set_cmode_char_template','set_cmode_grave_rates','get_cmode_prize_rank',
  'stage_end_multi_cm',
  'ba_set_lives','ba_set_target','ba_set_time_limit','ba_set_char',
  'ba_set_trap','ba_set_trapself','ba_set_trapmenu','ba_hide_self_traps',
  'ba_show_self_traps','ba_set_dmgtrap','ba_enable_sonar','ba_use_sonar',
  'ba_teams','ba_initial_floor','ba_get_place','ba_get_score',
  'ba_forbid_scape_doll','ba_dropwep','ba_box_drops','ba_set_equip',
  'ba_set_item','ba_set_mag','ba_set_meseta','ba_set_tech','ba_set_tech_lvl',
  'ba_ignoretrap','ba_set_lvl','ba_disp_msg',
  'set_ba_rules','check_rank_time',
  'BB_Map_Designate','BB_box_create_BP','BB_check_wrap',
  'BB_exchage_PT','BB_exchange_PC','BB_exchange_PD_item',
  'BB_exchange_PD_percent','BB_exchange_PD_special',
  'BB_exchange_PD_srank','BB_get_number_in_pack',
  'BB_p2_menu','BB_set_ep4boss_can_escape','BB_swap_item',
  'gba_unknown1','gba_unknown2','gba_unknown3','gba_unknown5',
  'NPC_action_string','animation_check','stop_animation',
  'use_animation','start_setevt_v1','start_setevt_v3',
  'control_dragon','release_dragon','pad_dragon',
  'falz_is_dead','olga_is_dead','volopt_is_dead',
  'color_change','shrink','unshrink',
  'set_shrink_cam1','set_shrink_cam2','set_shrink_size',
  'set_ult_map','unset_ult_map','reverse_warps','unreverse_warps',
  'warp_on','warp_off','set_mainwarp','clear_mainwarp',
  'party_has_name','get_encryption_key','encrypt_gc_entry_auto',
  'if_switch_pressed','if_switch_not_pressed',
  'pcam_param_V1','pcam_param_V3',
  'call_image_data','load_enemy_data','load_npc_data',
  'get_attack_data','get_ba_record',
  'unknownF88A','unknownF817','unknownF82F','unknownF874',
  'unknownF8B7','unknownF8BB','unknownF8EF','unknownF943',
  'unknownF960','unknownF961','unknownF3','unknownF4',
  'unknownF5','unknownF6','unknownF7','unknownF8',
  'unknownFB','unknownFC','unknownAD','unknown9C',
  'unknown9D','unknown9E','unknown9F','unknownBC',
  // DC-era aliases that appear in disassembled code
  'QEXIT','QuEXIT2','Keyword',
];

// ─── Language registration ─────────────────────────────────────────────────

export const LANGUAGE_ID = 'pso-asm';

export function registerPsoAsm(monaco: typeof Monaco): void {
  // Guard: only register once
  if (monaco.languages.getLanguages().some(l => l.id === LANGUAGE_ID)) return;

  monaco.languages.register({ id: LANGUAGE_ID, extensions: ['.bin.asm', '.pso'] });

  monaco.languages.setLanguageConfiguration(LANGUAGE_ID, {
    comments: { lineComment: '//' },
    folding: {
      markers: {
        start: /^\s*\/\/ #region\b/,
        end:   /^\s*\/\/ #endregion\b/,
      },
    },
  });

  // ─── Tokeniser ────────────────────────────────────────────────────────

  monaco.languages.setMonarchTokensProvider(LANGUAGE_ID, {
    defaultToken: '',
    tokenPostfix: '.pso',

    // ── Opcode keywords (matched as 'keyword') ─────────────────────────
    keywords: OPCODES,

    // ── Directives ────────────────────────────────────────────────────
    directives: ['HEX', 'STR', 'RAW'],

    tokenizer: {
      root: [
        // Comments
        [/\/\/.*$/, 'comment'],

        // Label: digits followed by colon, only at the very start of a line
        [/^\d+:/, 'label'],

        // Directives: HEX: or STR: (must come before general identifier rule)
        [/\b(HEX|STR):/, 'directive'],

        // RAW: unknown opcode tail — styled as a warning
        [/\bRAW:/, 'directive.raw'],

        // Registers: R followed by 1-3 digits
        [/\bR\d{1,3}\b/, 'register'],

        // Hex numbers: 0x prefix or bare 8-digit hex in argument position
        [/\b0[xX][0-9a-fA-F]+\b/, 'number.hex'],
        [/\b[0-9a-fA-F]{8}\b/, 'number.hex'],

        // Decimal integers
        [/\b\d+\b/, 'number'],

        // Floats
        [/\b\d+\.\d+\b/, 'number.float'],

        // String literals in single quotes — enter string state for escape highlighting
        [/'/, { token: 'string.delim', next: '@string' }],

        // Identifiers / opcodes
        [/[a-zA-Z_][a-zA-Z0-9_=!<>]*/, {
          cases: {
            '@keywords': 'keyword',
            '@default': 'identifier',
          },
        }],

        // Comma separator (uncoloured)
        [/,/, 'delimiter'],
      ],

      string: [
        // PSO control-code escapes: \xNN
        [/\\x[0-9a-fA-F]{2}/, 'string.escape'],
        // Newline marker
        [/<cr>/, 'string.escape'],
        // End of string
        [/'/, { token: 'string.delim', next: '@pop' }],
        // Everything else in the string
        [/[^'\\<]+/, 'string'],
        // Stray '<' that isn't part of <cr>
        [/</, 'string'],
      ],
    },
  } as Monaco.languages.IMonarchLanguage);

  // ─── Auto-completion ──────────────────────────────────────────────────

  monaco.languages.registerCompletionItemProvider(LANGUAGE_ID, {
    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber:   position.lineNumber,
        startColumn:     word.startColumn,
        endColumn:       word.endColumn,
      };

      const opcodeItems: Monaco.languages.CompletionItem[] = OPCODES.map(op => ({
        label: op,
        kind: monaco.languages.CompletionItemKind.Function,
        insertText: op,
        range,
      }));

      // Suggest R0..R255
      const regItems: Monaco.languages.CompletionItem[] = Array.from(
        { length: 256 }, (_, i) => ({
          label: `R${i}`,
          kind: monaco.languages.CompletionItemKind.Variable,
          insertText: `R${i}`,
          range,
        })
      );

      return { suggestions: [...opcodeItems, ...regItems] };
    },
  });

  // ─── Hover documentation ──────────────────────────────────────────────

  const OPCODE_DOCS: Record<string, string> = {
    nop:    'No operation.',
    ret:    'Return from the current function.',
    sync:   'Synchronize execution (yield to game engine).',
    exit:   'Exit the quest script.',
    thread: 'Create a new execution thread at the given function label.',
    let:    'Copy register value: `let Rdest, Rsrc`',
    leti:   'Load immediate dword into register: `leti Rdest, VALUE`',
    letb:   'Load immediate byte into register: `letb Rdest, VALUE`',
    letw:   'Load immediate word into register: `letw Rdest, VALUE`',
    jmp:    'Unconditional jump to label: `jmp LABEL`',
    call:   'Call function at label: `call LABEL`',
    'jmp_=':  'Jump if Rn == Rm: `jmp_= Rn, Rm, LABEL`',
    'jmpi_=': 'Jump if Rn == immediate: `jmpi_= Rn, VALUE, LABEL`',
    'jmp_!=': 'Jump if Rn != Rm.',
    'jmp_>':  'Jump if Rn > Rm (signed).',
    'jmp_<':  'Jump if Rn < Rm (signed).',
    add:    'Add registers: `add Rdest, Rsrc`',
    addi:   'Add immediate: `addi Rdest, VALUE`',
    sub:    'Subtract registers.',
    mul:    'Multiply registers.',
    div:    'Divide registers.',
    and:    'Bitwise AND.',
    or:     'Bitwise OR.',
    xor:    'Bitwise XOR.',
    message:'Display NPC message: `message NPC_ID, \'text\'`',
    window_msg: 'Display window message: `window_msg \'text\'`',
    add_msg:'Append to current message: `add_msg \'text\'`',
    mesend: 'End current message display.',
    set_floor_handler: 'Register a function to call when entering a floor: `set_floor_handler FLOOR_ID, LABEL`',
    clr_floor_handler: 'Remove the floor handler for a floor.',
    switch_on:  'Activate a switch object.',
    switch_off: 'Deactivate a switch object.',
    bgm:    'Play background music track: `bgm TRACK_ID`',
    fadein: 'Fade screen in.',
    fadeout:'Fade screen out.',
    hud_hide:'Hide the HUD.',
    hud_show:'Show the HUD.',
    set_qt_success:'Mark quest as succeeded.',
    set_qt_failure:'Mark quest as failed.',
    set_qt_cancel: 'Mark quest as cancelled.',
    set_qt_exit:   'Set the function to call on quest exit.',
    get_difflvl:  'Get current difficulty level into register: `get_difflvl Rdest`',
    get_player_hp:'Get player HP into register.',
    get_player_level:'Get player level into register.',
    go_floor:     'Warp all players to a floor.',
    set_mainwarp: 'Set the main warp destination.',
    sync_register:'Sync register value across all players: `sync_register Rdest, Rsrc`',
    item_create:  'Create an item: `item_create Rtype, Rparams`',
    item_delete:  'Delete an item.',
    item_check:   'Check if player has an item.',
    freeze_enemies: 'Freeze all enemies on the floor.',
    unfreeze_enemies: 'Unfreeze all enemies.',
    kill_player:  'Kill a player.',
    exp_multiplication: 'Set experience multiplier.',
    dec2float:    'Convert integer register to float.',
    float2dec:    'Convert float register to integer.',
    sin:  'Compute sine of register value.',
    cos:  'Compute cosine of register value.',
    fadd: 'Add float registers.',
    fmul: 'Multiply float registers.',
  };

  monaco.languages.registerHoverProvider(LANGUAGE_ID, {
    provideHover(model, position) {
      const word = model.getWordAtPosition(position);
      if (!word) return null;
      const doc = OPCODE_DOCS[word.word];
      if (!doc) return null;
      return {
        range: new monaco.Range(
          position.lineNumber, word.startColumn,
          position.lineNumber, word.endColumn,
        ),
        contents: [
          { value: `**${word.word}**` },
          { value: doc },
        ],
      };
    },
  });
}

// ─── Theme definition ──────────────────────────────────────────────────────

export function definePsoTheme(monaco: typeof Monaco): void {
  monaco.editor.defineTheme('pso-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment',      foreground: 'a0a0a0', fontStyle: 'italic' },
      { token: 'label',        foreground: 'f0c040', fontStyle: 'bold' },
      { token: 'keyword',      foreground: 'ffffff', fontStyle: 'bold' },
      { token: 'register',     foreground: '80ff40' },
      { token: 'number',       foreground: 'ff80ff' },
      { token: 'number.hex',   foreground: 'ff80ff' },
      { token: 'number.float', foreground: 'ff80ff' },
      { token: 'string',        foreground: '40ffff' },
      { token: 'string.delim', foreground: '40ffff' },
      { token: 'string.escape',foreground: 'ff8040' },
      { token: 'directive',     foreground: 'a0a0a0', fontStyle: 'bold' },
      { token: 'directive.raw', foreground: 'ffa040', fontStyle: 'bold' },
      { token: 'identifier',   foreground: 'cccccc' },
      { token: 'delimiter',    foreground: '666666' },
    ],
    colors: {
      'editor.background':          '#0a0a30',
      'editor.foreground':          '#cccccc',
      'editor.lineHighlightBackground': '#141450',
      'editorLineNumber.foreground':'#505080',
      'editorCursor.foreground':    '#ffffff',
      'editor.selectionBackground': '#2040a0',
      // Suggestion / autocomplete widget
      'editorSuggestWidget.background':              '#1a1a40',
      'editorSuggestWidget.border':                  '#303070',
      'editorSuggestWidget.foreground':              '#cccccc',
      'editorSuggestWidget.selectedBackground':      '#2040a0',
      'editorSuggestWidget.selectedForeground':      '#ffffff',
      'editorSuggestWidget.highlightForeground':     '#60a0ff',
      'editorSuggestWidget.focusHighlightForeground':'#60a0ff',
    },
  });
}
