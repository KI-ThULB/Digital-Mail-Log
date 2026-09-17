import 'package:flutter/foundation.dart';

enum Direction {
  incoming('Eingang'),
  outgoing('Ausgang');

  const Direction(this.label);
  final String label;
}

const shipmentTypes = ['Brief', 'Paket', 'Einschreiben', 'Sonstige'];

int? parsePostage(String input) {
  final value = input.trim();
  if (value.isEmpty) return null;
  if (value.length > 12 || !RegExp(r'^[0-9]+([,.][0-9]{1,2})?$').hasMatch(value)) {
    throw const FormatException('Betrag ohne Tausendertrennzeichen, z. B. 1,80');
  }
  final parts = value.split(RegExp('[,.]'));
  return int.parse(parts.first) * 100 +
      (parts.length == 1 ? 0 : int.parse(parts.last.padRight(2, '0')));
}

String money(int? cents) => cents == null
    ? 'Nicht angegeben'
    : '${cents ~/ 100},${(cents % 100).toString().padLeft(2, '0')} €';

String shortDate(DateTime date) =>
    '${date.day.toString().padLeft(2, '0')}.${date.month.toString().padLeft(2, '0')}.${date.year}';

@immutable
class MailFields {
  MailFields({
    required this.direction,
    required DateTime date,
    this.sender = '',
    this.recipient = '',
    this.description = '',
    this.shipmentType = 'Brief',
    this.postageCents,
    String? psp,
  }) : date = DateTime(date.year, date.month, date.day),
       psp = psp == null || psp.trim().isEmpty ? null : psp.trim() {
    if (postageCents != null && postageCents! < 0) {
      throw const FormatException('Porto darf nicht negativ sein.');
    }
    if (this.psp != null &&
        (this.psp!.length > 128 || RegExp(r'[\x00-\x1f\x7f]').hasMatch(this.psp!))) {
      throw const FormatException('Ungültiges PSP-Element.');
    }
    if (direction == Direction.incoming && (postageCents != null || this.psp != null)) {
      throw const FormatException('Porto und PSP-Element sind nur beim Ausgang möglich.');
    }
    if (!shipmentTypes.contains(shipmentType)) {
      throw const FormatException('Unbekannte Sendungsart.');
    }
    for (final text in [sender, recipient, description]) {
      if (text.length > 4000) throw const FormatException('Text ist zu lang.');
    }
  }

  final Direction direction;
  final DateTime date;
  final String sender, recipient, description, shipmentType;
  final int? postageCents;
  final String? psp;

  String get searchable =>
      '$sender $recipient $description $shipmentType ${psp ?? ''}'.toLowerCase();
}

@immutable
class Revision {
  const Revision(this.fields, this.version, this.recordedAt);
  final MailFields fields;
  final int version;
  final DateTime recordedAt;
}

@immutable
class MailEntry {
  MailEntry(this.id, List<Revision> revisions)
    : revisions = List.unmodifiable(revisions);
  final int id;
  final List<Revision> revisions;
  Revision get current => revisions.last;
  String get number => 'TEST-${id.toString().padLeft(4, '0')}';
}

class VersionConflict implements Exception {}

/// Deliberately volatile demo repository. Never use for operational mail data.
class MailStore extends ChangeNotifier {
  MailStore({DateTime Function()? clock}) : _clock = clock ?? DateTime.now;
  final DateTime Function() _clock;
  final Map<int, MailEntry> _entries = {};
  int _nextId = 1;

  MailEntry? byId(int id) => _entries[id];

  MailEntry create(MailFields fields) {
    final entry = MailEntry(_nextId++, [Revision(fields, 1, _clock().toUtc())]);
    _entries[entry.id] = entry;
    notifyListeners();
    return entry;
  }

  MailEntry update(int id, MailFields fields, {required int expectedVersion}) {
    final original = _entries[id];
    if (original == null || original.current.version != expectedVersion) {
      throw VersionConflict();
    }
    final entry = MailEntry(id, [
      ...original.revisions,
      Revision(fields, expectedVersion + 1, _clock().toUtc()),
    ]);
    _entries[id] = entry;
    notifyListeners();
    return entry;
  }

  List<MailEntry> search({
    String query = '',
    Direction? direction,
    String? shipmentType,
    DateTime? from,
    DateTime? until,
  }) {
    final words = query.trim().toLowerCase().split(RegExp(r'\s+'));
    final matches = _entries.values.where((entry) {
      final f = entry.current.fields;
      return (direction == null || f.direction == direction) &&
          (shipmentType == null || f.shipmentType == shipmentType) &&
          (from == null || !f.date.isBefore(from)) &&
          (until == null || !f.date.isAfter(until)) &&
          words.every(f.searchable.contains);
    }).toList();
    matches.sort((a, b) {
      final order = b.current.fields.date.compareTo(a.current.fields.date);
      return order == 0 ? b.id.compareTo(a.id) : order;
    });
    return matches;
  }
}
