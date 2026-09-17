import 'package:flutter/material.dart';

import 'domain.dart';

class MailOverview extends StatefulWidget {
  const MailOverview({super.key, required this.store});
  final MailStore store;

  @override
  State<MailOverview> createState() => _MailOverviewState();
}

class _MailOverviewState extends State<MailOverview> {
  String query = '';
  Direction? direction;
  String? type;
  DateTimeRange? range;

  void edit([MailEntry? entry]) => Navigator.of(context).push<void>(
    MaterialPageRoute(builder: (_) => MailEditor(store: widget.store, entry: entry)),
  );

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Digitales Postbuch')),
    floatingActionButton: FloatingActionButton.extended(
      onPressed: () => edit(),
      icon: const Icon(Icons.add),
      label: const Text('Sendung erfassen'),
    ),
    body: SafeArea(
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 1040),
          child: ListenableBuilder(
            listenable: widget.store,
            builder: (context, _) {
              final entries = widget.store.search(
                query: query, direction: direction, shipmentType: type,
                from: range?.start, until: range?.end,
              );
              return CustomScrollView(slivers: [
                SliverPadding(
                  padding: const EdgeInsets.all(20),
                  sliver: SliverList.list(children: [
                    const Card(
                      color: Color(0xffffedc2),
                      child: Padding(
                        padding: EdgeInsets.all(16),
                        child: Text('Testversion · Nur Beispieldaten verwenden. '
                            'Einträge gehen beim Beenden der App verloren.'),
                      ),
                    ),
                    const SizedBox(height: 20),
                    Text('Ihre Post im Überblick', style: Theme.of(context).textTheme.headlineSmall),
                    const SizedBox(height: 8),
                    const Text('Eingänge und Ausgänge erfassen, finden und berichtigen.'),
                    const SizedBox(height: 20),
                    TextField(
                      key: const Key('search'),
                      decoration: const InputDecoration(
                        labelText: 'Postbuch durchsuchen',
                        hintText: 'Name, Inhalt oder PSP-Element',
                        prefixIcon: Icon(Icons.search),
                      ),
                      onChanged: (value) => setState(() => query = value),
                    ),
                    const SizedBox(height: 12),
                    Wrap(spacing: 8, runSpacing: 8, children: [
                      ChoiceChip(label: const Text('Alle'), selected: direction == null,
                        onSelected: (_) => setState(() => direction = null)),
                      for (final d in Direction.values)
                        ChoiceChip(label: Text(d.label), selected: direction == d,
                          onSelected: (_) => setState(() => direction = d)),
                      PopupMenuButton<String>(
                        tooltip: 'Nach Sendungsart filtern',
                        onSelected: (value) => setState(() => type = value == 'Alle Arten' ? null : value),
                        itemBuilder: (_) => ['Alle Arten', ...shipmentTypes].map((value) =>
                          PopupMenuItem(value: value, child: Text(value))).toList(),
                        child: Chip(avatar: const Icon(Icons.filter_list), label: Text(type ?? 'Alle Arten')),
                      ),
                      ActionChip(
                        avatar: const Icon(Icons.date_range),
                        label: Text(range == null ? 'Zeitraum' : '${shortDate(range!.start)} – ${shortDate(range!.end)}'),
                        onPressed: () async {
                          final chosen = await showDateRangePicker(context: context,
                            firstDate: DateTime(1900), lastDate: DateTime(2100), initialDateRange: range);
                          if (chosen != null && mounted) setState(() => range = chosen);
                        },
                      ),
                      if (range != null)
                        ActionChip(label: const Text('Zeitraum löschen'),
                          onPressed: () => setState(() => range = null)),
                    ]),
                    const SizedBox(height: 20),
                    Text('${entries.length} Sendungen', style: Theme.of(context).textTheme.titleMedium),
                    if (entries.isEmpty)
                      Padding(padding: const EdgeInsets.symmetric(vertical: 48),
                        child: Text(widget.store.search().isEmpty
                          ? 'Noch keine Sendungen. Beginnen Sie mit „Sendung erfassen“.'
                          : 'Keine passenden Sendungen. Ändern Sie die Suche oder die Filter.')),
                  ]),
                ),
                SliverPadding(
                  padding: const EdgeInsets.symmetric(horizontal: 20),
                  sliver: SliverList.builder(
                    itemCount: entries.length,
                    itemBuilder: (context, index) {
                      final entry = entries[index];
                      final f = entry.current.fields;
                      return Card(
                        clipBehavior: Clip.antiAlias,
                        child: InkWell(
                          onTap: () => Navigator.of(context).push<void>(MaterialPageRoute(
                            builder: (_) => MailDetails(store: widget.store, id: entry.id))),
                          child: Padding(padding: const EdgeInsets.all(16), child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Wrap(spacing: 16, runSpacing: 4, children: [
                                Text('${f.direction.label} · ${shortDate(f.date)}',
                                  style: TextStyle(color: Theme.of(context).colorScheme.primary, fontWeight: FontWeight.bold)),
                                Text('${entry.number} · ${f.shipmentType}'),
                              ]),
                              const SizedBox(height: 8),
                              Text('${f.sender.isEmpty ? 'Absender unbekannt' : f.sender} → '
                                '${f.recipient.isEmpty ? 'Empfänger unbekannt' : f.recipient}',
                                style: Theme.of(context).textTheme.titleMedium),
                              if (f.description.isNotEmpty) ...[
                                const SizedBox(height: 6), Text(f.description, maxLines: 2, overflow: TextOverflow.ellipsis),
                              ],
                              if (f.direction == Direction.outgoing) ...[
                                const SizedBox(height: 8),
                                Text('Porto: ${money(f.postageCents)} · PSP: ${f.psp ?? 'Nicht angegeben'}'),
                              ],
                            ],
                          )),
                        ),
                      );
                    },
                  ),
                ),
                const SliverToBoxAdapter(child: SizedBox(height: 100)),
              ]);
            },
          ),
        ),
      ),
    ),
  );
}

class MailDetails extends StatelessWidget {
  const MailDetails({super.key, required this.store, required this.id});
  final MailStore store;
  final int id;

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: store,
    builder: (context, _) {
      final entry = store.byId(id)!;
      final f = entry.current.fields;
      return Scaffold(
        appBar: AppBar(title: Text(entry.number)),
        body: SingleChildScrollView(padding: const EdgeInsets.all(20), child: Center(
          child: ConstrainedBox(constraints: const BoxConstraints(maxWidth: 760), child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text('${f.direction.label} · ${shortDate(f.date)}', style: Theme.of(context).textTheme.headlineSmall),
              const SizedBox(height: 20),
              for (final pair in <String, String>{
                'Absender': f.sender.isEmpty ? 'Unbekannt' : f.sender,
                'Empfänger': f.recipient.isEmpty ? 'Unbekannt' : f.recipient,
                'Sendungsart': f.shipmentType,
                'Beschreibung': f.description.isEmpty ? 'Inhalt unbekannt' : f.description,
                if (f.direction == Direction.outgoing) 'Portokosten': money(f.postageCents),
                if (f.direction == Direction.outgoing) 'PSP-Element': f.psp ?? 'Nicht angegeben',
              }.entries)
                Padding(padding: const EdgeInsets.only(bottom: 16), child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [Text(pair.key, style: Theme.of(context).textTheme.labelLarge),
                    SelectableText(pair.value)],
                )),
              FilledButton.icon(
                onPressed: () => Navigator.of(context).push<void>(MaterialPageRoute(
                  builder: (_) => MailEditor(store: store, entry: entry))),
                icon: const Icon(Icons.edit_outlined), label: const Text('Bearbeiten'),
              ),
              const SizedBox(height: 24),
              Text('Änderungsverlauf', style: Theme.of(context).textTheme.titleLarge),
              for (final revision in entry.revisions.reversed)
                ExpansionTile(
                  title: Text('Version ${revision.version}'),
                  subtitle: Text('Erfasst am ${shortDate(revision.recordedAt.toLocal())} '
                    '${TimeOfDay.fromDateTime(revision.recordedAt.toLocal()).format(context)}'),
                  children: [Padding(padding: const EdgeInsets.all(16), child: Align(
                    alignment: Alignment.centerLeft,
                    child: Text('${revision.fields.direction.label} · ${shortDate(revision.fields.date)}\n'
                      '${revision.fields.sender} → ${revision.fields.recipient}\n'
                      '${revision.fields.shipmentType} · ${revision.fields.description}\n'
                      '${revision.fields.direction == Direction.outgoing ? 'Porto: ${money(revision.fields.postageCents)} · PSP: ${revision.fields.psp ?? 'Nicht angegeben'}' : ''}'),
                  ))],
                ),
            ],
          )),
        )),
      );
    },
  );
}

class MailEditor extends StatefulWidget {
  const MailEditor({super.key, required this.store, this.entry});
  final MailStore store;
  final MailEntry? entry;

  @override
  State<MailEditor> createState() => _MailEditorState();
}

class _MailEditorState extends State<MailEditor> {
  final form = GlobalKey<FormState>();
  late final TextEditingController sender, recipient, description, postage, psp;
  late Direction direction;
  late DateTime date;
  late String type;
  bool dirty = false;
  bool leaving = false;

  @override
  void initState() {
    super.initState();
    final f = widget.entry?.current.fields;
    direction = f?.direction ?? Direction.incoming;
    date = f?.date ?? DateTime.now();
    type = f?.shipmentType ?? 'Brief';
    sender = TextEditingController(text: f?.sender);
    recipient = TextEditingController(text: f?.recipient);
    description = TextEditingController(text: f?.description);
    postage = TextEditingController(text: f?.postageCents == null ? '' : money(f!.postageCents).replaceAll(' €', ''));
    psp = TextEditingController(text: f?.psp);
  }

  @override
  void dispose() {
    for (final c in [sender, recipient, description, postage, psp]) { c.dispose(); }
    super.dispose();
  }

  Future<bool> confirm(String title, String message, String action) async =>
    await showDialog<bool>(context: context, builder: (context) => AlertDialog(
      title: Text(title), content: Text(message), actions: [
        TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Abbrechen')),
        FilledButton(onPressed: () => Navigator.pop(context, true), child: Text(action)),
      ],
    )) ?? false;

  Future<void> close() async {
    if (dirty && !await confirm('Eingaben verwerfen?', 'Die ungespeicherten Änderungen gehen verloren.', 'Verwerfen')) return;
    if (!mounted) return;
    setState(() => leaving = true);
    WidgetsBinding.instance.addPostFrameCallback((_) { if (mounted) Navigator.of(context).pop(); });
  }

  Future<void> changeDirection(Direction next) async {
    if (next == direction) return;
    if (next == Direction.incoming && (postage.text.isNotEmpty || psp.text.isNotEmpty)) {
      if (!await confirm('Kostenfelder entfernen?',
          'Eingehende Post hat keine Portokosten und kein PSP-Element. '
          'Beim Wechsel werden diese Eingaben entfernt. Frühere gespeicherte Versionen bleiben erhalten.', 'Entfernen')) return;
      if (!mounted) return;
      postage.clear();
      psp.clear();
    }
    if (mounted) setState(() { direction = next; dirty = true; });
  }

  void save() {
    if (!form.currentState!.validate()) return;
    try {
      final fields = MailFields(direction: direction, date: date,
        sender: sender.text.trim(), recipient: recipient.text.trim(),
        description: description.text.trim(), shipmentType: type,
        postageCents: direction == Direction.outgoing ? parsePostage(postage.text) : null,
        psp: direction == Direction.outgoing ? psp.text : null);
      final original = widget.entry;
      if (original == null) { widget.store.create(fields); }
      else { widget.store.update(original.id, fields, expectedVersion: original.current.version); }
      setState(() { dirty = false; leaving = true; });
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) Navigator.of(context).pop();
      });
    } on VersionConflict {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('Die Sendung wurde inzwischen geändert. Bitte Eingaben sichern, zurückgehen und neu öffnen.')));
    } on FormatException catch (error) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.message)));
    }
  }

  Widget textField(String label, TextEditingController controller, {int lines = 1}) =>
    Padding(padding: const EdgeInsets.only(bottom: 16), child: TextFormField(
      controller: controller, decoration: InputDecoration(labelText: label),
      maxLines: lines, maxLength: 4000,
      buildCounter: (_, {required currentLength, required isFocused, required maxLength}) => null,
      validator: (v) => (v?.length ?? 0) > 4000 ? 'Maximal 4000 Zeichen.' : null,
    ));

  @override
  Widget build(BuildContext context) => PopScope(
    canPop: leaving || !dirty,
    onPopInvokedWithResult: (didPop, result) { if (!didPop) close(); },
    child: Scaffold(
      appBar: AppBar(title: Text(widget.entry == null ? 'Neue Sendung' : 'Sendung bearbeiten'),
        leading: IconButton(tooltip: 'Zurück', onPressed: close, icon: const Icon(Icons.arrow_back))),
      body: SafeArea(child: SingleChildScrollView(padding: const EdgeInsets.all(20), child: Center(
        child: ConstrainedBox(constraints: const BoxConstraints(maxWidth: 760), child: Form(
          key: form, onChanged: () { if (!dirty) setState(() => dirty = true); },
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Wrap(spacing: 12, runSpacing: 8, children: [
              for (final d in Direction.values)
                ChoiceChip(label: Text(d.label), selected: direction == d,
                  onSelected: (_) => changeDirection(d)),
            ]),
            const SizedBox(height: 20),
            OutlinedButton.icon(onPressed: () async {
              final chosen = await showDatePicker(context: context, initialDate: date,
                firstDate: DateTime(1900), lastDate: DateTime(2100));
              if (chosen != null && mounted) setState(() { date = chosen; dirty = true; });
            }, icon: const Icon(Icons.calendar_today_outlined), label: Text('Sendungsdatum: ${shortDate(date)}')),
            const SizedBox(height: 16),
            textField('Absender', sender),
            textField('Empfänger', recipient),
            DropdownButtonFormField<String>(initialValue: type,
              decoration: const InputDecoration(labelText: 'Sendungsart'),
              items: shipmentTypes.map((t) => DropdownMenuItem(value: t, child: Text(t))).toList(),
              onChanged: (value) => setState(() { type = value!; dirty = true; })),
            const SizedBox(height: 16),
            textField('Beschreibung (optional)', description, lines: 3),
            if (direction == Direction.outgoing) ...[
              TextFormField(controller: postage,
                decoration: const InputDecoration(labelText: 'Portokosten (EUR, optional)',
                  hintText: 'z. B. 1,80', helperText: 'Leer = unbekannt · 0,00 = portofrei'),
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                validator: (v) { try { parsePostage(v ?? ''); return null; }
                  on FormatException catch (e) { return e.message; } }),
              const SizedBox(height: 16),
              TextFormField(controller: psp, maxLength: 128,
                decoration: const InputDecoration(labelText: 'PSP-Element (optional)'),
                validator: (v) => v != null && RegExp(r'[\x00-\x1f\x7f]').hasMatch(v)
                  ? 'Keine Steuerzeichen verwenden.' : null),
              const SizedBox(height: 16),
            ],
            FilledButton.icon(onPressed: save, icon: const Icon(Icons.check), label: const Text('Speichern')),
            const SizedBox(height: 24),
          ]),
        )),
      ))),
    ),
  );
}
